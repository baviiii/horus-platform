'use client';

/**
 * Full-duplex voice via the Azure OpenAI GA Realtime API over WebRTC.
 *
 * One click opens a live call: mic audio streams up, the agent's voice
 * streams back on a remote track, and the server handles VAD + barge-in
 * natively. The session (model, prompt with connected sources, tools) is
 * configured server-side when the ephemeral key is minted — the browser
 * never sees a secret. Function calls arrive on the data channel and are
 * bridged to `/api/playground/voice/tool`, which runs the same executors
 * that ground the text agent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentCitationView } from '@/lib/playground-types';

export type CallState = 'idle' | 'connecting' | 'live';

export interface UseRealtimeVoice {
  callState: CallState;
  /** Model audio is currently playing (drives the speaking indicator). */
  agentSpeaking: boolean;
  /** false once the server reports voice unconfigured (503). */
  available: boolean;
  toggleCall: (sessionId: string) => void;
  endCall: () => void;
}

interface RealtimeEvent {
  type: string;
  // Present on the subset of events we consume; everything else is ignored.
  response_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
}

export function useRealtimeVoice(params: {
  onUserUtterance: (text: string) => void;
  onAgentDelta: (turnId: string, delta: string) => void;
  onAgentDone: (turnId: string) => void;
  onCitations: (turnId: string, citations: AgentCitationView[]) => void;
  onToolActivity: (label: string | null) => void;
  onNotice: (message: string) => void;
}): UseRealtimeVoice {
  const { onUserUtterance, onAgentDelta, onAgentDone, onCitations, onToolActivity, onNotice } =
    params;

  const [callState, setCallState] = useState<CallState>('idle');
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [available, setAvailable] = useState(true);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef('');
  const lastTurnRef = useRef('');

  // Callbacks live in a ref so the WebRTC wiring never goes stale.
  const cbRef = useRef({
    onUserUtterance,
    onAgentDelta,
    onAgentDone,
    onCitations,
    onToolActivity,
    onNotice,
  });
  cbRef.current = {
    onUserUtterance,
    onAgentDelta,
    onAgentDone,
    onCitations,
    onToolActivity,
    onNotice,
  };

  const endCall = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }
    cbRef.current.onToolActivity(null);
    setAgentSpeaking(false);
    setCallState('idle');
  }, []);

  const bridgeToolCall = useCallback(async (dc: RTCDataChannel, ev: RealtimeEvent) => {
    const name = ev.name ?? '';
    const callId = ev.call_id ?? '';
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(ev.arguments ?? '{}') as Record<string, unknown>;
    } catch {
      /* empty args */
    }

    cbRef.current.onToolActivity(
      name === 'search_knowledge'
        ? `searching “${typeof args.query === 'string' ? args.query : ''}”`
        : 'fetching page',
    );

    let output = 'Tool failed — answer with what you already know.';
    try {
      const res = await fetch('/api/playground/voice/tool', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionRef.current, name, args }),
      });
      if (res.ok) {
        const body = (await res.json()) as { output: string; citations: AgentCitationView[] };
        output = body.output;
        if (body.citations.length > 0 && lastTurnRef.current) {
          cbRef.current.onCitations(lastTurnRef.current, body.citations);
        }
      }
    } catch {
      /* keep failure output */
    }
    cbRef.current.onToolActivity(null);

    if (dc.readyState !== 'open') return;
    dc.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output },
      }),
    );
    dc.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  const handleEvent = useCallback(
    (dc: RTCDataChannel, raw: string) => {
      let ev: RealtimeEvent;
      try {
        ev = JSON.parse(raw) as RealtimeEvent;
      } catch {
        return;
      }

      switch (ev.type) {
        // GA name first, preview name second — same payload shape.
        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta': {
          const turnId = ev.response_id ?? 'turn';
          lastTurnRef.current = turnId;
          if (ev.delta) cbRef.current.onAgentDelta(turnId, ev.delta);
          break;
        }
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          cbRef.current.onAgentDone(ev.response_id ?? 'turn');
          break;
        case 'conversation.item.input_audio_transcription.completed':
          if (ev.transcript?.trim()) cbRef.current.onUserUtterance(ev.transcript.trim());
          break;
        case 'response.function_call_arguments.done':
          if (ev.response_id) lastTurnRef.current = ev.response_id;
          void bridgeToolCall(dc, ev);
          break;
        case 'output_audio_buffer.started':
          setAgentSpeaking(true);
          break;
        case 'output_audio_buffer.stopped':
        case 'output_audio_buffer.cleared':
          setAgentSpeaking(false);
          break;
        case 'error':
          cbRef.current.onNotice(ev.error?.message ?? 'Voice session error.');
          break;
        default:
          break;
      }
    },
    [bridgeToolCall],
  );

  const startCall = useCallback(
    async (sessionId: string) => {
      setCallState('connecting');
      sessionRef.current = sessionId;
      try {
        const mintRes = await fetch('/api/playground/voice/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        if (mintRes.status === 503) {
          setAvailable(false);
          cbRef.current.onNotice('Voice is not configured on this deployment yet.');
          endCall();
          return;
        }
        if (!mintRes.ok) {
          const body = (await mintRes.json().catch(() => null)) as { error?: string } | null;
          cbRef.current.onNotice(body?.error ?? 'Could not start the voice session.');
          endCall();
          return;
        }
        const { ephemeralKey, webrtcUrl } = (await mintRes.json()) as {
          ephemeralKey: string;
          webrtcUrl: string;
        };

        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        micRef.current = mic;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
        audioRef.current = audioEl;
        pc.ontrack = (event) => {
          if (event.streams[0]) audioEl.srcObject = event.streams[0];
        };
        pc.onconnectionstatechange = () => {
          if (
            pc.connectionState === 'failed' ||
            pc.connectionState === 'disconnected' ||
            pc.connectionState === 'closed'
          ) {
            if (pcRef.current === pc) endCall();
          }
        };

        pc.addTrack(mic.getAudioTracks()[0]!);

        const dc = pc.createDataChannel('realtime-channel');
        dcRef.current = dc;
        dc.addEventListener('message', (e) => handleEvent(dc, String(e.data)));
        dc.addEventListener('open', () => setCallState('live'));
        dc.addEventListener('close', () => {
          if (dcRef.current === dc) endCall();
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpRes = await fetch(webrtcUrl, {
          method: 'POST',
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            'Content-Type': 'application/sdp',
          },
        });
        if (!sdpRes.ok) {
          cbRef.current.onNotice(`Voice connection failed (${sdpRes.status}).`);
          endCall();
          return;
        }
        await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
      } catch (err) {
        cbRef.current.onNotice(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Microphone blocked — check browser permissions.'
            : 'Could not start the voice call.',
        );
        endCall();
      }
    },
    [endCall, handleEvent],
  );

  const toggleCall = useCallback(
    (sessionId: string) => {
      if (callState === 'idle') void startCall(sessionId);
      else endCall();
    },
    [callState, startCall, endCall],
  );

  // Tear the call down on unmount.
  useEffect(() => endCall, [endCall]);

  return { callState, agentSpeaking, available, toggleCall, endCall };
}
