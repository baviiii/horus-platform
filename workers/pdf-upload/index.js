const { BlobServiceClient } = require('@azure/storage-blob');

module.exports = async function (context, req) {
    context.log('PDF Upload function triggered');
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (req.method === 'OPTIONS') {
        context.res = { status: 204, headers };
        return;
    }

    try {
        const action = req.query.action || 'list';
        const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
        const containerName = process.env.BLOB_CONTAINER_NAME || 'rag-documents';
        const statusContainerName = 'processing-status';
        
        if (!connectionString) {
            context.res = {
                status: 500,
                headers,
                body: JSON.stringify({ error: 'Storage not configured. Contact admin.' })
            };
            return;
        }

        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const statusContainerClient = blobServiceClient.getContainerClient(statusContainerName);
        await containerClient.createIfNotExists();
        await statusContainerClient.createIfNotExists();

        if (action === 'list') {
            // List all PDFs with their processing status
            const blobs = [];
            const statusMap = {};
            
            // Load all status files
            for await (const statusBlob of statusContainerClient.listBlobsFlat()) {
                try {
                    const statusClient = statusContainerClient.getBlockBlobClient(statusBlob.name);
                    const downloadResponse = await statusClient.download(0);
                    const statusData = await streamToString(downloadResponse.readableStreamBody);
                    const pdfName = statusBlob.name.replace('.json', '');
                    statusMap[pdfName] = JSON.parse(statusData);
                } catch (e) {
                    // Ignore parse errors
                }
            }
            
            for await (const blob of containerClient.listBlobsFlat({ includeMetadata: true })) {
                if (blob.name.toLowerCase().endsWith('.pdf')) {
                    const estimatedPages = Math.round((blob.properties.contentLength || 0) / (500 * 1024));
                    blobs.push({
                        name: blob.name,
                        size: blob.properties.contentLength,
                        lastModified: blob.properties.lastModified,
                        estimatedPages,
                        processingStatus: statusMap[blob.name] || null,
                        metadata: blob.metadata || {}
                    });
                }
            }
            
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    count: blobs.length,
                    files: blobs.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
                })
            };
            return;
        }
        
        if (action === 'status') {
            // Get processing status for a specific file or all files
            const { blobName } = req.query;
            
            if (blobName) {
                try {
                    const statusClient = statusContainerClient.getBlockBlobClient(`${blobName}.json`);
                    const downloadResponse = await statusClient.download(0);
                    const statusData = await streamToString(downloadResponse.readableStreamBody);
                    context.res = {
                        status: 200,
                        headers,
                        body: statusData
                    };
                } catch (e) {
                    context.res = {
                        status: 200,
                        headers,
                        body: JSON.stringify({ status: 'pending', blobName })
                    };
                }
            } else {
                // Get all statuses
                const statuses = [];
                for await (const statusBlob of statusContainerClient.listBlobsFlat()) {
                    try {
                        const statusClient = statusContainerClient.getBlockBlobClient(statusBlob.name);
                        const downloadResponse = await statusClient.download(0);
                        const statusData = await streamToString(downloadResponse.readableStreamBody);
                        statuses.push(JSON.parse(statusData));
                    } catch (e) {
                        // Ignore
                    }
                }
                context.res = {
                    status: 200,
                    headers,
                    body: JSON.stringify({ success: true, statuses })
                };
            }
            return;
        }
        
        if (action === 'update_status') {
            // Update processing status (called by runbook)
            const { blobName, status, progress, step, error, result } = req.body || {};
            
            if (!blobName) {
                context.res = {
                    status: 400,
                    headers,
                    body: JSON.stringify({ error: 'blobName required' })
                };
                return;
            }
            
            const statusClient = statusContainerClient.getBlockBlobClient(`${blobName}.json`);
            let existingStatus = { blobName, steps: [] };
            
            try {
                const downloadResponse = await statusClient.download(0);
                const statusData = await streamToString(downloadResponse.readableStreamBody);
                existingStatus = JSON.parse(statusData);
            } catch (e) {
                // New status
            }
            
            const updatedStatus = {
                ...existingStatus,
                blobName,
                status: status || existingStatus.status || 'pending',
                progress: progress !== undefined ? progress : existingStatus.progress,
                lastUpdated: new Date().toISOString(),
                error: error || existingStatus.error,
                result: result || existingStatus.result
            };
            
            if (step) {
                updatedStatus.steps = [...(existingStatus.steps || []), {
                    step,
                    timestamp: new Date().toISOString()
                }];
            }
            
            await statusClient.upload(JSON.stringify(updatedStatus), JSON.stringify(updatedStatus).length, {
                blobHTTPHeaders: { blobContentType: 'application/json' },
                overwrite: true
            });
            
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify({ success: true, status: updatedStatus })
            };
            return;
        }

        if (action === 'upload') {
            // Handle file upload from base64
            const { fileName, fileData } = req.body || {};
            
            if (!fileName || !fileData) {
                context.res = {
                    status: 400,
                    headers,
                    body: JSON.stringify({ error: 'fileName and fileData required' })
                };
                return;
            }

            // Decode base64 and upload
            const buffer = Buffer.from(fileData, 'base64');
            const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
            const blobName = `${Date.now()}-${safeName}`;
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);
            
            await blockBlobClient.uploadData(buffer, {
                blobHTTPHeaders: { blobContentType: 'application/pdf' }
            });
            
            context.log(`Uploaded: ${blobName} (${buffer.length} bytes)`);
            
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    file: {
                        originalName: fileName,
                        blobName: blobName,
                        size: buffer.length,
                        uploadedAt: new Date().toISOString()
                    }
                })
            };
            return;
        }

        if (action === 'delete') {
            const { blobName } = req.body || {};
            if (!blobName) {
                context.res = {
                    status: 400,
                    headers,
                    body: JSON.stringify({ error: 'blobName required' })
                };
                return;
            }
            
            await containerClient.getBlockBlobClient(blobName).deleteIfExists();
            
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify({ success: true, deleted: blobName })
            };
            return;
        }

        context.res = {
            status: 400,
            headers,
            body: JSON.stringify({ error: `Unknown action: ${action}` })
        };

    } catch (error) {
        context.log.error('PDF Upload error:', error);
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

// Helper function to convert stream to string
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => {
            chunks.push(data.toString());
        });
        readableStream.on('end', () => {
            resolve(chunks.join(''));
        });
        readableStream.on('error', reject);
    });
}
