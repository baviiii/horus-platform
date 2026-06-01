# Local Web Scraper

Local-only SA Government web scraper using Playwright. Saves structured JSON to disk — no Azure or cloud dependencies.

## Setup

```bash
npm install
npm run install-browsers
```

## Usage

```bash
# Scrape all SA Gov sites
npm run scrape

# Scrape specific categories
npm run scrape:jobs
npm run scrape:skills
npm run scrape:news

# Custom output directory
node --max-old-space-size=4096 local-scraper.js --outputDir /path/to/output
```

## Output Structure

```
output/
  jobs/           # One JSON file per job source
  skills/         # One JSON file per skills source
  news/           # One JSON file per news source
  general/        # One JSON file per general source
  all-data.json   # Combined flat array of all chunks
  scrape-report.json  # Run metadata (timestamp, counts, success/failures)
```

Each chunk in the output follows this schema:

```json
{
  "id": "httpsiworkforsagovau-chunk-0",
  "title": "Search Jobs",
  "content": "...",
  "url": "https://iworkfor.sa.gov.au",
  "documentId": "https://iworkfor.sa.gov.au",
  "documentType": "web",
  "source": "https://iworkfor.sa.gov.au",
  "chunkIndex": 0,
  "pageNumber": 1,
  "category": "workforce",
  "sector": "public-sector",
  "tags": ["web-scraped", "south-australia", "employment", "jobs"],
  "publicationYear": null,
  "metadata": {
    "totalChunks": 3,
    "sourceUrl": "...",
    "scrapedAt": "...",
    "strategy": "jobs",
    "pagesScraped": 1,
    "dataSource": "local-scraper"
  },
  "scrapedAt": "2026-04-10T..."
}
```

## What Gets Scraped

- **Jobs**: jobs.sa.gov.au, I Work for SA, Public Sector Jobs, SA Gov employment pages
- **Skills**: Migration SA, Skills SA, Skilled Workers SA, Business SA
- **News**: Premier SA Media Releases, Skills SA News
- **General**: SA Gov Career Info, Public Sector Careers, SA Health Careers, Education SA
