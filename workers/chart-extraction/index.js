/**
 * Azure Function: Chart/Image/Graph Extraction
 * 
 * Clean implementation - Azure-native only:
 * 
 * Strategy 1: Direct image (base64 or URL) → GPT-4 Vision
 * Strategy 2: Azure Container Instance (PDF → PNG) → GPT-4 Vision [REQUIRED for PDFs]
 * Strategy 3: Document Intelligence figures → GPT-4 Vision (if imageData available)
 */

// ============================================================
// PDF PAGE RENDERING (Azure Container Instance Only)
// ============================================================

async function renderPdfPageToImage(pdfUrl, pageNumber, context) {
    // Azure Container Instance (uses your Azure credits!)
    const pdfRendererEndpoint = process.env.PDF_RENDERER_ENDPOINT;
    
    if (!pdfRendererEndpoint) {
        context.log.error('[PDF Render] PDF_RENDERER_ENDPOINT not configured. Deploy: .\\deploy-pdf-renderer.ps1');
        return null;
    }
    
    try {
        context.log(`[PDF Render] Using Azure Container Instance...`);
        
        const response = await fetch(`${pdfRendererEndpoint}/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfUrl, pageNumber })
        });
        
        if (response.ok) {
            const result = await response.json();
            if (result.success && result.image) {
                context.log(`[PDF Render] SUCCESS: Page ${pageNumber} (${result.size} bytes)`);
                return result.image;
            }
        }
        
        const errorText = await response.text().catch(() => 'Unknown error');
        context.log.error(`[PDF Render] ACI failed (${response.status}): ${errorText.substring(0, 200)}`);
    } catch (error) {
        context.log.error(`[PDF Render] ACI error: ${error.message}`);
    }
    
    return null;
}

// ============================================================
// MAIN FUNCTION
// ============================================================

module.exports = async function (context, req) {
    context.log('Chart Extraction - Clean v3');
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (req.method === 'OPTIONS') {
        context.res = { status: 204, headers };
        return;
    }

    try {
        const { imageData, imageUrl, pdfUrl, pageNumber, boundingBox, documentId, metadata } = req.body;

        if (!imageData && !imageUrl && !pdfUrl) {
            context.res = { status: 400, headers, body: JSON.stringify({ error: 'imageData, imageUrl, or pdfUrl required' }) };
            return;
        }

        const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const openAIKey = process.env.AZURE_OPENAI_KEY;
        const visionDeployment = process.env.AZURE_OPENAI_VISION_DEPLOYMENT || 'gpt-4o-mini';
        
        if (!openAIEndpoint || !openAIKey) {
            context.res = { status: 500, headers, body: JSON.stringify({ error: 'Azure OpenAI not configured' }) };
            return;
        }

        // ============================================================
        // GET IMAGE CONTENT
        // ============================================================
        
        let imageContent = null;
        let renderMethod = 'none';
        let extractedContext = metadata || {};
        
        // Strategy 1: Direct image
        if (imageData) {
            context.log('Using provided base64 image');
            renderMethod = 'provided_base64';
            imageContent = { type: "image_url", image_url: { url: `data:image/png;base64,${imageData}`, detail: "high" } };
        } 
        else if (imageUrl && !imageUrl.toLowerCase().endsWith('.pdf')) {
            context.log('Using direct image URL');
            renderMethod = 'direct_url';
            imageContent = { type: "image_url", image_url: { url: imageUrl, detail: "high" } };
        }
        // Strategy 1.5: PDF rendering via ACI
        else if (pdfUrl || imageUrl) {
            const targetUrl = pdfUrl || imageUrl;
            context.log(`Processing PDF page ${pageNumber || 1}`);
            
            const renderedImage = await renderPdfPageToImage(targetUrl, pageNumber || 1, context);
            
            if (renderedImage) {
                renderMethod = 'pdf_page_render';
                imageContent = { type: "image_url", image_url: { url: `data:image/png;base64,${renderedImage}`, detail: "high" } };
            }
        }

        // No image available
        if (!imageContent) {
            context.log.warn('No image content available');
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Could not obtain image. Deploy PDF renderer: .\\deploy-pdf-renderer.ps1',
                    extraction: { visualType: 'unknown', confidence: 0, chartData: null },
                    metadata: { pageNumber, documentId, renderMethod }
                })
            };
            return;
        }

        // ============================================================
        // CALL GPT-4 VISION
        // ============================================================
        
        const extractionPrompt = `Analyze this image and extract ALL data from charts, graphs, diagrams, or visual elements.

Return JSON:
{
  "visualType": "bar_chart" | "pie_chart" | "line_graph" | "scatter_plot" | "diagram" | "flowchart" | "infographic" | "image" | "table" | "no_visual",
  "confidence": 0.0-1.0,
  "title": "title if visible",
  "chartData": {
    "labels": ["label1", "label2"],
    "datasets": [{ "name": "Series", "values": [1, 2, 3], "color": "blue" }],
    "axes": { "x": { "label": "X axis" }, "y": { "label": "Y axis", "unit": "units" } }
  },
  "diagramData": {
    "nodes": [{ "id": "1", "text": "Node text" }],
    "edges": [{ "from": "1", "to": "2" }]
  },
  "description": "Brief description",
  "extractedText": ["visible", "text"]
}

Be PRECISE with numbers - extract actual values!`;

        context.log(`Calling ${visionDeployment}...`);
        
        const visionResponse = await fetch(
            `${openAIEndpoint}/openai/deployments/${visionDeployment}/chat/completions?api-version=2024-02-15-preview`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'api-key': openAIKey },
                body: JSON.stringify({
                    messages: [{ role: "user", content: [{ type: "text", text: extractionPrompt }, imageContent] }],
                    max_tokens: 4000,
                    temperature: 0.1
                })
            }
        );

        if (!visionResponse.ok) {
            const errorText = await visionResponse.text();
            context.log.error('Vision API error:', errorText);
            
            let errorDetails = 'Vision API failed';
            try { errorDetails = JSON.parse(errorText).error?.message || errorText.substring(0, 200); } catch {}
            
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: errorDetails,
                    extraction: { visualType: 'unknown', confidence: 0, chartData: null },
                    metadata: { pageNumber, documentId, renderMethod }
                })
            };
            return;
        }

        const visionResult = await visionResponse.json();
        const extractedContent = visionResult.choices[0]?.message?.content;

        // Parse JSON response
        let extractedData;
        try {
            const jsonMatch = extractedContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                              extractedContent.match(/```\s*([\s\S]*?)\s*```/) ||
                              [null, extractedContent];
            extractedData = JSON.parse(jsonMatch[1] || extractedContent);
        } catch {
            extractedData = { visualType: 'unknown', confidence: 0.5, description: extractedContent, chartData: null };
        }

        context.log(`SUCCESS: ${extractedData.visualType} (confidence: ${extractedData.confidence}, method: ${renderMethod})`);

        context.res = {
            status: 200,
            headers,
            body: JSON.stringify({
                success: true,
                extraction: { ...extractedData, renderMethod },
                metadata: {
                    pageNumber,
                    boundingBox,
                    documentId,
                    extractedAt: new Date().toISOString(),
                    model: visionDeployment,
                    tokensUsed: visionResult.usage?.total_tokens || 0
                }
            })
        };

    } catch (error) {
        context.log.error('Chart extraction error:', error);
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
