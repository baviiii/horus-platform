/**
 * Enterprise Web Scraper for SA Government Websites
 * Uses Playwright for browser automation - handles JavaScript, anti-bot, dynamic content
 *
 * Usage:
 *   node --max-old-space-size=4096 scraper.js --resourceGroup "rg-careercraft-dev" [--jobsOnly] [--skillsOnly] [--newsOnly]
 */

const playwright = require('playwright');
const chromium = playwright.chromium;
const fs = require('fs');
const path = require('path');

// Configuration
const TARGETS = {
  jobs: [
    { name: 'SA Jobs Portal', url: 'https://jobs.sa.gov.au', strategy: 'jobs' },
    { name: 'I Work for SA', url: 'https://iworkfor.sa.gov.au', strategy: 'jobs' },
    {
      name: 'Public Sector Jobs',
      url: 'https://www.publicsector.sa.gov.au/working-in-the-public-sector/job-opportunities',
      strategy: 'jobs',
    },
    {
      name: 'SA Gov - Looking for Work',
      url: 'https://www.sa.gov.au/topics/employment-and-work/looking-for-work',
      strategy: 'jobs',
    },
    {
      name: 'SA Gov - Finding a Job',
      url: 'https://www.sa.gov.au/topics/employment-and-work/finding-a-job',
      strategy: 'jobs',
    },
  ],
  skills: [
    {
      name: 'Migration SA',
      url: 'https://www.migration.sa.gov.au',
      strategy: 'skills',
      followLinks: true,
    },
    {
      name: 'Migration SA - Occupation List',
      url: 'https://www.migration.sa.gov.au/occupation-lists/south-australia-skilled-occupation-list',
      strategy: 'skills',
    },
    { name: 'Skills SA', url: 'https://www.skills.sa.gov.au', strategy: 'skills' },
    {
      name: 'Skilled Workers SA',
      url: 'https://skilledworkers.business.sa.gov.au',
      strategy: 'skills',
    },
    { name: 'Business SA', url: 'https://www.business.sa.gov.au', strategy: 'skills' },
  ],
  news: [
    {
      name: 'Premier SA Media Releases',
      url: 'https://www.premier.sa.gov.au/media-releases',
      strategy: 'news',
    },
    { name: 'Skills SA News', url: 'https://www.skills.sa.gov.au/news', strategy: 'news' },
  ],
  general: [
    {
      name: 'SA Gov Career Info',
      url: 'https://www.sa.gov.au/topics/employment-and-work/career-information',
      strategy: 'general',
    },
    {
      name: 'Public Sector Careers',
      url: 'https://www.publicsector.sa.gov.au',
      strategy: 'general',
    },
    {
      name: 'SA Health Careers',
      url: 'https://www.sahealth.sa.gov.au/careers',
      strategy: 'general',
    },
    { name: 'Education SA', url: 'https://www.education.sa.gov.au', strategy: 'general' },
  ],
};

// Extract content based on strategy
function extractContent(page, strategy) {
  switch (strategy) {
    case 'jobs':
      return page.evaluate(() => {
        // Try to find job listings
        const jobs = [];
        // Look for common job posting containers
        const selectors = [
          'article',
          '[class*="job"]',
          '[class*="vacancy"]',
          '[class*="position"]',
          '[class*="listing"]',
        ];

        selectors.forEach((selector) => {
          document.querySelectorAll(selector).forEach((el) => {
            const text = el.innerText?.trim();
            if (text && text.length > 50) {
              jobs.push(text);
            }
          });
        });

        // If no jobs found, get main content
        if (jobs.length === 0) {
          const main =
            document.querySelector('main') ||
            document.querySelector('[role="main"]') ||
            document.body;
          return main?.innerText?.trim() || '';
        }

        return jobs.join('\n\n');
      });

    case 'skills':
    case 'general':
      return page.evaluate(() => {
        // Get main content area
        const selectors = [
          'main',
          '[role="main"]',
          'article',
          '.content',
          '#content',
          '.main-content',
        ];

        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText?.trim().length > 200) {
            return el.innerText.trim();
          }
        }

        // Fallback to body
        return document.body?.innerText?.trim() || '';
      });

    case 'news':
      return page.evaluate(() => {
        const news = [];
        const selectors = [
          'article',
          '[class*="news"]',
          '[class*="media-release"]',
          '[class*="update"]',
        ];

        selectors.forEach((selector) => {
          document.querySelectorAll(selector).forEach((el) => {
            const text = el.innerText?.trim();
            if (text && text.length > 100) {
              news.push(text);
            }
          });
        });

        return news.length > 0 ? news.join('\n\n') : document.body?.innerText?.trim() || '';
      });

    default:
      return page.evaluate(() => document.body?.innerText?.trim() || '');
  }
}

// Function to discover important internal links on a page
async function discoverImportantLinks(page, baseUrl, visitedUrls) {
  try {
    const links = await page.evaluate((baseUrl) => {
      const importantKeywords = [
        'occupation',
        'occupation-list',
        'skilled-occupation',
        'visa',
        'nomination',
        'career',
        'job',
        'employment',
        'skills',
        'training',
        'education',
        'migration',
        'immigration',
        'workforce',
        'industry',
      ];

      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      const discovered = [];
      const baseDomain = new URL(baseUrl).hostname;

      for (const link of allLinks) {
        try {
          const href = link.getAttribute('href');
          if (!href) continue;

          const fullUrl = new URL(href, baseUrl).href;
          const linkDomain = new URL(fullUrl).hostname;

          // Only follow links from same domain
          if (linkDomain !== baseDomain) continue;

          // Check if link text or URL contains important keywords
          const linkText = (link.textContent || '').toLowerCase();
          const urlLower = fullUrl.toLowerCase();

          const isImportant = importantKeywords.some(
            (keyword) => linkText.includes(keyword) || urlLower.includes(keyword),
          );

          if (isImportant) {
            discovered.push({
              url: fullUrl,
              text: linkText.trim(),
              href: href,
            });
          }
        } catch (e) {
          continue;
        }
      }

      // Remove duplicates and return
      const unique = [];
      const seen = new Set();
      for (const link of discovered) {
        const normalized = link.url.split('#')[0].split('?')[0];
        if (!seen.has(normalized)) {
          seen.add(normalized);
          unique.push(link);
        }
      }

      return unique.slice(0, 10); // Limit to 10 important links per page
    }, baseUrl);

    // Filter out already visited URLs
    return links.filter((link) => {
      const normalized = link.url.split('#')[0].split('?')[0];
      return !visitedUrls.has(normalized);
    });
  } catch (e) {
    return [];
  }
}

// Main scraping function with pagination and scrolling
async function scrapeWebsite(browser, target, options = {}) {
  const { waitForSelector, waitForTimeout = 2000, maxPages = 10, followLinks = false } = options;

  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    console.log(`  → Scraping: ${target.name}`);
    console.log(`    URL: ${target.url}`);

    let allContent = [];
    let currentUrl = target.url;
    let pageNum = 1;
    let pageTitle = null;
    const visitedUrls = new Set(); // Track visited URLs to prevent loops
    const linkQueue = []; // Queue for discovered links to scrape
    const shouldFollowLinks = target.followLinks || followLinks;

    // Navigate through multiple pages
    while (pageNum <= maxPages && currentUrl) {
      try {
        // Normalize URL to check for duplicates
        const normalizedUrl = currentUrl.split('#')[0].split('?')[0];
        if (visitedUrls.has(normalizedUrl)) {
          console.log(`    [Page ${pageNum}] Already visited, stopping pagination`);
          break;
        }
        visitedUrls.add(normalizedUrl);

        console.log(`    [Page ${pageNum}] Loading: ${currentUrl}`);

        // Navigate to page with timeout
        await Promise.race([
          page.goto(currentUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Navigation timeout')), 35000),
          ),
        ]);

        console.log(`    [Page ${pageNum}] Page loaded, waiting for content...`);

        // Wait for content to load (for dynamic sites)
        if (waitForSelector) {
          try {
            await page.waitForSelector(waitForSelector, { timeout: 8000 });
          } catch (e) {
            // Selector not found, continue anyway
          }
        }

        // Additional wait for JavaScript to render
        await page.waitForTimeout(waitForTimeout);

        console.log(`    [Page ${pageNum}] Scrolling to load all content...`);

        // Scroll down incrementally to trigger lazy loading (with timeout)
        await Promise.race([
          page.evaluate(async () => {
            const scrollStep = 500;
            const scrollDelay = 200; // Faster scrolling
            const maxScrolls = 15; // Reduced scrolls

            for (let i = 0; i < maxScrolls; i++) {
              window.scrollBy(0, scrollStep);
              await new Promise((resolve) => setTimeout(resolve, scrollDelay));

              if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 100) {
                break;
              }
            }

            window.scrollTo(0, 0);
            await new Promise((resolve) => setTimeout(resolve, 300));
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Scroll timeout')), 5000)),
        ]).catch((err) => {
          console.log(`    [Page ${pageNum}] Scroll warning: ${err.message}`);
        });

        console.log(`    [Page ${pageNum}] Extracting content...`);

        // Get title (only on first page)
        if (pageNum === 1) {
          pageTitle = await page.title().catch(() => target.name);
        }

        // Extract content from this page
        const pageContent = await extractContent(page, target.strategy);

        if (pageContent && pageContent.length > 100) {
          allContent.push({
            page: pageNum,
            content: pageContent,
            url: currentUrl,
          });
          console.log(`    [Page ${pageNum}] Extracted: ${pageContent.length} chars`);
        } else {
          console.log(
            `    [Page ${pageNum}] Content too short (${pageContent?.length || 0} chars), may be last page`,
          );
        }

        // Discover important links if enabled (on first page)
        if (shouldFollowLinks && pageNum === 1) {
          console.log(`    [Page ${pageNum}] Discovering important links...`);
          const discoveredLinks = await discoverImportantLinks(page, target.url, visitedUrls);
          for (const link of discoveredLinks) {
            const normalized = link.url.split('#')[0].split('?')[0];
            if (!visitedUrls.has(normalized)) {
              linkQueue.push(link.url);
              console.log(`    [Page ${pageNum}] Discovered: ${link.text.substring(0, 50)}...`);
            }
          }
        }

        // Try to find next page link (only if we haven't reached max pages)
        if (pageNum >= maxPages) {
          console.log(`    [Page ${pageNum}] Reached max pages limit (${maxPages})`);
          break;
        }

        console.log(`    [Page ${pageNum}] Looking for next page...`);
        let nextUrl = null;

        // First, check if we have links in queue
        if (linkQueue.length > 0) {
          nextUrl = linkQueue.shift();
          console.log(`    [Page ${pageNum}] Using queued link: ${nextUrl}`);
        } else {
          // Try to find explicit "next" buttons/links
          nextUrl = await page.evaluate(() => {
            const nextSelectors = [
              'a[aria-label*="next" i]',
              'a[aria-label*="Next" i]',
              '.pagination .next:not(.disabled)',
              '.pagination-next:not(.disabled)',
              'a.next:not(.disabled)',
              'a[class*="next"]:not([class*="disabled"])',
            ];

            for (const selector of nextSelectors) {
              try {
                const link = document.querySelector(selector);
                if (
                  link &&
                  !link.classList.contains('disabled') &&
                  link.getAttribute('aria-disabled') !== 'true'
                ) {
                  const href = link.getAttribute('href');
                  if (href) {
                    try {
                      const fullUrl = new URL(href, window.location.href).href;
                      if (fullUrl !== window.location.href) {
                        return fullUrl;
                      }
                    } catch (e) {
                      continue;
                    }
                  }
                }
              } catch (e) {
                continue;
              }
            }

            // If no explicit next button, don't auto-increment - let it stop
            return null;
          });
        }

        // Only use nextUrl if we found an actual next button or have queued links
        if (!nextUrl) {
          console.log(`    [Page ${pageNum}] No next page link found, stopping pagination`);
          break;
        }

        // Check if nextUrl is different from current
        const currentFullUrl = page.url();
        const normalizedNext = nextUrl.split('#')[0].split('?')[0];
        const normalizedCurrent = currentFullUrl.split('#')[0].split('?')[0];

        if (
          normalizedNext === normalizedCurrent ||
          normalizedNext === currentUrl.split('#')[0].split('?')[0]
        ) {
          console.log(`    [Page ${pageNum}] Next URL same as current, stopping`);
          break;
        }

        currentUrl = nextUrl;
        pageNum++;

        // Small delay before next page
        await page.waitForTimeout(1000);
      } catch (pageError) {
        console.log(`    [Page ${pageNum}] Error: ${pageError.message}`);
        break;
      }
    }

    await page.close();

    // Combine all page content
    if (allContent.length > 0) {
      const combinedContent = allContent
        .map((p) => `[Page ${p.page} - ${p.url}]\n${p.content}`)
        .join('\n\n---\n\n');

      return {
        success: true,
        title: pageTitle || target.name,
        content: combinedContent,
        url: target.url,
        pagesScraped: pageNum - 1,
        strategy: target.strategy,
      };
    } else {
      return {
        success: false,
        error: 'No content extracted from any page',
        url: target.url,
      };
    }
  } catch (error) {
    await page.close().catch(() => {});
    return {
      success: false,
      error: error.message,
      url: target.url,
    };
  }
}

// ============================================================
// LABELING FUNCTIONS - Document Metadata Extraction
// ============================================================
// NOTE: Labeling logic is intentionally duplicated in PDF parser (process-pdfs.ps1)
//       See ../../docs/LABELING-RULES.md for complete reference
//       When updating these functions, consider updating PDF parser too
//       Web-specific enhancements (strategy hints, URL checks) are OK to keep separate
// ============================================================

// Enhanced metadata extraction functions (matching PDF processing)
function extractCategory(title, content, strategy) {
  const lowerTitle = (title || '').toLowerCase();
  const lowerContent = (content || '').toLowerCase().substring(0, 2000);

  // Strategy-based defaults
  if (strategy === 'jobs') return 'workforce';
  if (strategy === 'skills') return 'workforce';
  if (strategy === 'news') return 'report';

  // Title-based detection
  if (lowerTitle.match(/budget|financial|revenue|expenditure/)) return 'budget';
  if (lowerTitle.match(/strategy|strategic|plan|roadmap/)) return 'strategy';
  if (lowerTitle.match(/workforce|employment|jobs|career/)) return 'workforce';
  if (lowerTitle.match(/education|learning|school|training/)) return 'education';
  if (lowerTitle.match(/health|medical|hospital/)) return 'health';
  if (lowerTitle.match(/interview|resume|cv|selection/)) return 'career-guidance';
  if (lowerTitle.match(/report|annual|review/)) return 'report';
  if (lowerTitle.match(/policy|guideline|procedure/)) return 'policy';

  // Content-based detection
  if (lowerContent.match(/budget|appropriation|revenue|expenditure/)) return 'budget';
  if (lowerContent.match(/interview|resume|selection criteria/)) return 'career-guidance';
  if (lowerContent.match(/workforce|employment|job market/)) return 'workforce';

  return 'government-document';
}

function extractSector(content, url) {
  const lowerContent = (content || '').toLowerCase().substring(0, 3000);
  const lowerUrl = (url || '').toLowerCase();

  if (lowerContent.match(/health|hospital|nursing|medical|sa health/) || lowerUrl.match(/health/))
    return 'health';
  if (
    lowerContent.match(/education|school|teacher|learning|department for education/) ||
    lowerUrl.match(/education/)
  )
    return 'education';
  if (
    lowerContent.match(/public sector|government|department|commissioner for public sector/) ||
    lowerUrl.match(/publicsector/)
  )
    return 'public-sector';
  if (lowerContent.match(/construction|building|infrastructure/)) return 'construction';
  if (lowerContent.match(/technology|it|digital|software|ict/) || lowerUrl.match(/tech/))
    return 'technology';
  if (lowerContent.match(/agriculture|farming|rural/)) return 'agriculture';
  if (lowerContent.match(/mining|resources|energy/)) return 'resources';
  if (lowerContent.match(/retail|hospitality|tourism/)) return 'services';
  if (lowerContent.match(/finance|accounting|treasury/)) return 'finance';
  if (lowerContent.match(/defense|security|police/) || lowerUrl.match(/defence/)) return 'defense';
  if (lowerContent.match(/transport|logistics/)) return 'transport';
  if (lowerContent.match(/community|social services|welfare/)) return 'community-services';

  return 'general';
}

function extractTags(content, title, category, sector) {
  const tags = [];
  const lowerContent = (content || '').toLowerCase();
  const lowerTitle = (title || '').toLowerCase();
  const combined = `${lowerTitle} ${lowerContent}`;

  // Always add base tags
  tags.push('web-scraped', 'south-australia');

  // Category-based tags
  if (category === 'workforce') tags.push('employment', 'jobs');
  if (category === 'career-guidance') tags.push('job-application', 'career-advice');
  if (category === 'budget') tags.push('budget', 'funding');
  if (category === 'education') tags.push('education', 'training');

  // Content-based tags
  if (combined.match(/south australia|sa government/)) tags.push('south-australia');
  if (combined.match(/education|school|learning/)) tags.push('education');
  if (combined.match(/health|medical|nursing/)) tags.push('health');
  if (combined.match(/employment|job|career|workforce/)) tags.push('employment');
  if (combined.match(/budget|financial|funding/)) tags.push('budget');
  if (combined.match(/training|skills|qualification/)) tags.push('training');
  if (combined.match(/interview|resume|application/)) tags.push('job-application');
  if (combined.match(/migration|immigrant|visa/)) tags.push('migration');
  if (combined.match(/regional|rural|country/)) tags.push('regional');
  if (combined.match(/disability|inclusion|accessibility/)) tags.push('disability-inclusion');
  if (combined.match(/indigenous|aboriginal/)) tags.push('indigenous');
  if (combined.match(/youth|young people|graduate/)) tags.push('youth');

  // Sector tag
  if (sector && sector !== 'general') tags.push(sector);

  // Remove duplicates
  return [...new Set(tags)];
}

function extractPublicationYear(title, content) {
  // Try to extract year from title (most reliable)
  const titleMatch = (title || '').match(/\b(19|20)\d{2}\b/);
  if (titleMatch) {
    const year = parseInt(titleMatch[0]);
    if (year >= 2000 && year <= new Date().getFullYear() + 1) {
      return year;
    }
  }

  // Try to extract from content
  const contentMatch = (content || '').match(/\b(20\d{2})\b/);
  if (contentMatch) {
    const years = contentMatch[0] ? [parseInt(contentMatch[0])] : [];
    const validYears = years.filter((y) => y >= 2000 && y <= new Date().getFullYear() + 1);
    if (validYears.length > 0) {
      return Math.max(...validYears);
    }
  }

  return null;
}

// Chunk content for embeddings (matching PDF processing strategy)
function chunkContent(content, chunkSize = 800, overlap = 200) {
  const chunks = [];
  let position = 0;
  let previousPosition = -1;
  let iterations = 0;
  const maxIterations = Math.ceil(content.length / (chunkSize - overlap)) + 10; // Safety limit

  while (position < content.length && iterations < maxIterations) {
    iterations++;

    const end = Math.min(position + chunkSize, content.length);
    const chunk = content.substring(position, end).trim();

    // Always add chunk if it exists, even if small (we'll filter later if needed)
    if (chunk.length > 50) {
      chunks.push(chunk);
    }

    // Calculate next position
    const nextPosition = end - overlap;

    // Safety check: ensure we're making progress
    if (nextPosition <= position) {
      // Not advancing, force advance
      position = end;
      if (position >= content.length) {
        break;
      }
    } else {
      position = nextPosition;
    }

    // Additional safety: if position didn't change, break
    if (position === previousPosition) {
      break;
    }
    previousPosition = position;
  }

  // Filter out very small chunks (except if it's the only chunk)
  if (chunks.length > 1) {
    return chunks.filter((chunk) => chunk.length > 100);
  }

  return chunks;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const resourceGroup =
    args.find((arg) => arg.startsWith('--resourceGroup'))?.split('=')[1] || 'rg-careercraft-dev';
  const jobsOnly = args.includes('--jobsOnly');
  const skillsOnly = args.includes('--skillsOnly');
  const newsOnly = args.includes('--newsOnly');

  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  Enterprise Web Scraper (Playwright)');
  console.log('════════════════════════════════════════');
  console.log('');
  console.log(`Resource Group: ${resourceGroup}`);
  console.log('');

  // Determine which targets to scrape
  let targets = [];
  if (jobsOnly) {
    targets = TARGETS.jobs;
  } else if (skillsOnly) {
    targets = TARGETS.skills;
  } else if (newsOnly) {
    targets = TARGETS.news;
  } else {
    targets = [...TARGETS.jobs, ...TARGETS.skills, ...TARGETS.news, ...TARGETS.general];
  }

  console.log(`Scraping ${targets.length} websites...`);
  console.log('');

  const results = [];
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, `scraped-content-${Date.now()}.json`);
  const allDocuments = [];

  // Process in batches to manage memory - restart browser every 3 sites
  const batchSize = 3;
  let browser = null;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];

    // Restart browser every batchSize sites to free memory
    if (i % batchSize === 0) {
      if (browser) {
        await browser.close();
        browser = null;
      }

      // Small delay before restarting
      await new Promise((resolve) => setTimeout(resolve, 1000));

      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-images', // Don't load images to save memory
          '--disable-javascript-harmony-shipping',
          '--disable-background-networking',
        ],
      });
    }

    // Delay between requests (be respectful)
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(`\n[${i + 1}/${targets.length}] Scraping: ${target.name}`);
    try {
      const result = await scrapeWebsite(browser, target, {
        waitForTimeout: 1500, // Reduced wait time
        maxPages: 10, // Scrape up to 10 pages per site
      });

      results.push(result);

      if (result.success) {
        const pagesInfo = result.pagesScraped ? ` (${result.pagesScraped} pages)` : '';
        console.log(`  ✓ Success: ${result.title}${pagesInfo} (${result.content.length} chars)`);
        console.log(`  → Starting to chunk content...`);

        // Chunk the content (matching PDF processing: 800 chars, 200 overlap)
        const chunks = chunkContent(result.content, 800, 200);
        console.log(`  → Created ${chunks.length} chunk(s)`);

        console.log(`  → Processing chunks into documents...`);
        chunks.forEach((chunk, idx) => {
          try {
            // Create unique ID for each chunk (matching PDF processing format)
            const baseId = result.url.replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
            const docId = `${baseId}-chunk-${idx}`;

            // Enhanced metadata extraction (matching PDF processing quality)
            const category = extractCategory(result.title, chunk, result.strategy);
            const sector = extractSector(chunk, result.url);
            const tags = extractTags(chunk, result.title, category, sector);
            const publicationYear = extractPublicationYear(result.title, chunk);

            // Add metadata structure matching PDF processing
            // CRITICAL: Web content is LIVE - track freshness for updates
            const metadata = {
              totalChunks: chunks.length,
              sourceUrl: result.url,
              scrapedAt: new Date().toISOString(),
              lastScraped: new Date().toISOString(), // Track when this specific scrape happened
              strategy: result.strategy,
              pagesScraped: result.pagesScraped || 1,
              isLiveData: true, // Mark as live/changeable content (vs static PDFs)
              dataSource: 'web-scraper', // Identify source for freshness tracking
            };

            allDocuments.push({
              id: docId,
              title: result.title,
              content: chunk,
              url: result.url,
              documentId: result.url, // For grouping chunks from same page
              documentType: 'web',
              source: result.url,
              chunkIndex: idx,
              pageNumber: 1, // Web pages are single "page"
              category: category,
              sector: sector,
              tags: tags,
              publicationYear: publicationYear,
              metadata: JSON.stringify(metadata),
              indexedAt: new Date().toISOString(),
            });
          } catch (chunkError) {
            console.log(`  ✗ Error processing chunk ${idx}: ${chunkError.message}`);
          }
        });
        console.log(
          `  → Processed ${chunks.length} chunk(s), total documents: ${allDocuments.length}`,
        );

        // Save incrementally every 2 sites to reduce memory pressure
        if ((i + 1) % 2 === 0 && allDocuments.length > 0) {
          console.log(`  → Saving progress to file...`);
          try {
            // Append to existing file or create new
            let existingData = [];
            if (fs.existsSync(outputFile)) {
              try {
                existingData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
              } catch (e) {
                console.log(`  → Warning: Could not read existing file, starting fresh`);
                existingData = [];
              }
            }
            const combined = [...existingData, ...allDocuments];
            fs.writeFileSync(outputFile, JSON.stringify(combined, null, 2));
            console.log(`  ✓ Saved progress: ${combined.length} total documents`);
            // Clear array after saving to free memory
            allDocuments.length = 0;
          } catch (saveError) {
            console.log(`  ✗ Error saving file: ${saveError.message}`);
          }
        } else {
          console.log(`  → Not saving yet (will save after ${2 - ((i + 1) % 2)} more site(s))`);
        }
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
      }
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      results.push({ success: false, error: error.message, url: target.url });
    }

    console.log(`  [Completed site ${i + 1}/${targets.length}]`);
    console.log('');
  }

  if (browser) {
    await browser.close();
  }

  // Final save - append any remaining documents
  if (allDocuments.length > 0) {
    let existingData = [];
    if (fs.existsSync(outputFile)) {
      try {
        existingData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
      } catch (e) {
        existingData = [];
      }
    }
    const combined = [...existingData, ...allDocuments];
    fs.writeFileSync(outputFile, JSON.stringify(combined, null, 2));
  }

  // Reload final count from file for summary
  let finalDocuments = [];
  if (fs.existsSync(outputFile)) {
    try {
      finalDocuments = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    } catch (e) {
      finalDocuments = [];
    }
  }

  // Summary
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  Scraping Complete');
  console.log('════════════════════════════════════════');
  console.log('');
  console.log(`Successful: ${results.filter((r) => r.success).length}/${results.length}`);
  console.log(`Total Documents: ${finalDocuments.length}`);
  console.log(`Output File: ${outputFile}`);
  console.log('');
  console.log('Next step: Run PowerShell script to upload to Azure AI Search');
  console.log('');
}

// Run
main().catch(console.error);
