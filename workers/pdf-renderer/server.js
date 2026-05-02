/**
 * PDF Renderer Service
 * 
 * Runs in Azure Container Instance (ACI)
 * Converts PDF pages to PNG images using Poppler
 * 
 * Endpoint: POST /render
 * Body: { pdfUrl: string, pageNumber: number }
 * Response: { success: boolean, image: string (base64) }
 */

const express = require('express');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'pdf-renderer' });
});

// Main rendering endpoint
app.post('/render', async (req, res) => {
    const { pdfUrl, pageNumber = 1 } = req.body;
    
    if (!pdfUrl) {
        return res.status(400).json({ success: false, error: 'pdfUrl required' });
    }
    
    const tempId = crypto.randomUUID();
    const pdfPath = `/tmp/${tempId}.pdf`;
    const outputPath = `/tmp/${tempId}`;
    
    try {
        console.log(`[RENDER] Downloading PDF from: ${pdfUrl.substring(0, 80)}...`);
        
        // Download PDF
        const response = await axios.get(pdfUrl, { 
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 100 * 1024 * 1024 // 100MB max
        });
        
        fs.writeFileSync(pdfPath, response.data);
        console.log(`[RENDER] Downloaded PDF: ${response.data.length} bytes`);
        
        // Convert specific page to PNG using pdftoppm (Poppler)
        // pdftoppm -f PAGE -l PAGE -png INPUT OUTPUT
        const command = `pdftoppm -f ${pageNumber} -l ${pageNumber} -png -r 200 "${pdfPath}" "${outputPath}"`;
        console.log(`[RENDER] Running: ${command}`);
        
        execSync(command, { stdio: 'pipe' });
        
        // Find the output file (pdftoppm adds page number suffix)
        const outputFiles = fs.readdirSync('/tmp').filter(f => f.startsWith(tempId) && f.endsWith('.png'));
        
        if (outputFiles.length === 0) {
            throw new Error('No PNG output generated');
        }
        
        const pngPath = `/tmp/${outputFiles[0]}`;
        const imageBuffer = fs.readFileSync(pngPath);
        const base64Image = imageBuffer.toString('base64');
        
        console.log(`[RENDER] SUCCESS: Page ${pageNumber} rendered (${imageBuffer.length} bytes)`);
        
        // Cleanup
        fs.unlinkSync(pdfPath);
        fs.unlinkSync(pngPath);
        
        res.json({
            success: true,
            image: base64Image,
            pageNumber,
            size: imageBuffer.length
        });
        
    } catch (error) {
        console.error(`[RENDER] ERROR: ${error.message}`);
        
        // Cleanup on error
        try { fs.unlinkSync(pdfPath); } catch {}
        fs.readdirSync('/tmp')
            .filter(f => f.startsWith(tempId))
            .forEach(f => { try { fs.unlinkSync(`/tmp/${f}`); } catch {} });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`PDF Renderer service running on port ${PORT}`);
    console.log('Ready to accept requests at POST /render');
});
