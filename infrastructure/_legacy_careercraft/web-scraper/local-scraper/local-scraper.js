/**
 * Local Web Scraper for SA Government Websites
 * Uses Playwright for browser automation - saves data locally as JSON (no cloud dependencies)
 *
 * Usage:
 *   node --max-old-space-size=4096 local-scraper.js [--jobsOnly] [--skillsOnly] [--newsOnly] [--outputDir ./output]
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
        const jobs = [];
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

          if (linkDomain !== baseDomain) continue;

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

      const unique = [];
      const seen = new Set();
      for (const link of discovered) {
        const normalized = link.url.split('#')[0].split('?')[0];
        if (!seen.has(normalized)) {
          seen.add(normalized);
          unique.push(link);
        }
      }

      return unique.slice(0, 10);
    }, baseUrl);

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
    const visitedUrls = new Set();
    const linkQueue = [];
    const shouldFollowLinks = target.followLinks || followLinks;

    while (pageNum <= maxPages && currentUrl) {
      try {
        const normalizedUrl = currentUrl.split('#')[0].split('?')[0];
        if (visitedUrls.has(normalizedUrl)) {
          console.log(`    [Page ${pageNum}] Already visited, stopping pagination`);
          break;
        }
        visitedUrls.add(normalizedUrl);

        console.log(`    [Page ${pageNum}] Loading: ${currentUrl}`);

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

        if (waitForSelector) {
          try {
            await page.waitForSelector(waitForSelector, { timeout: 8000 });
          } catch (e) {
            // Selector not found, continue anyway
          }
        }

        await page.waitForTimeout(waitForTimeout);

        console.log(`    [Page ${pageNum}] Scrolling to load all content...`);

        await Promise.race([
          page.evaluate(async () => {
            const scrollStep = 500;
            const scrollDelay = 200;
            const maxScrolls = 15;

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

        if (pageNum === 1) {
          pageTitle = await page.title().catch(() => target.name);
        }

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

        if (pageNum >= maxPages) {
          console.log(`    [Page ${pageNum}] Reached max pages limit (${maxPages})`);
          break;
        }

        console.log(`    [Page ${pageNum}] Looking for next page...`);
        let nextUrl = null;

        if (linkQueue.length > 0) {
          nextUrl = linkQueue.shift();
          console.log(`    [Page ${pageNum}] Using queued link: ${nextUrl}`);
        } else {
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

            return null;
          });
        }

        if (!nextUrl) {
          console.log(`    [Page ${pageNum}] No next page link found, stopping pagination`);
          break;
        }

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

        await page.waitForTimeout(1000);
      } catch (pageError) {
        console.log(`    [Page ${pageNum}] Error: ${pageError.message}`);
        break;
      }
    }

    await page.close();

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

function extractCategory(title, content, strategy) {
  const lowerTitle = (title || '').toLowerCase();
  const lowerContent = (content || '').toLowerCase().substring(0, 2000);

  if (strategy === 'jobs') return 'workforce';
  if (strategy === 'skills') return 'workforce';
  if (strategy === 'news') return 'report';

  if (lowerTitle.match(/budget|financial|revenue|expenditure/)) return 'budget';
  if (lowerTitle.match(/strategy|strategic|plan|roadmap/)) return 'strategy';
  if (lowerTitle.match(/workforce|employment|jobs|career/)) return 'workforce';
  if (lowerTitle.match(/education|learning|school|training/)) return 'education';
  if (lowerTitle.match(/health|medical|hospital/)) return 'health';
  if (lowerTitle.match(/interview|resume|cv|selection/)) return 'career-guidance';
  if (lowerTitle.match(/report|annual|review/)) return 'report';
  if (lowerTitle.match(/policy|guideline|procedure/)) return 'policy';

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

  tags.push('web-scraped', 'south-australia');

  if (category === 'workforce') tags.push('employment', 'jobs');
  if (category === 'career-guidance') tags.push('job-application', 'career-advice');
  if (category === 'budget') tags.push('budget', 'funding');
  if (category === 'education') tags.push('education', 'training');

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

  if (sector && sector !== 'general') tags.push(sector);

  return [...new Set(tags)];
}

function extractPublicationYear(title, content) {
  const titleMatch = (title || '').match(/\b(19|20)\d{2}\b/);
  if (titleMatch) {
    const year = parseInt(titleMatch[0]);
    if (year >= 2000 && year <= new Date().getFullYear() + 1) {
      return year;
    }
  }

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

// Chunk content (800 chars, 200 overlap)
function chunkContent(content, chunkSize = 800, overlap = 200) {
  const chunks = [];
  let position = 0;
  let previousPosition = -1;
  let iterations = 0;
  const maxIterations = Math.ceil(content.length / (chunkSize - overlap)) + 10;

  while (position < content.length && iterations < maxIterations) {
    iterations++;

    const end = Math.min(position + chunkSize, content.length);
    const chunk = content.substring(position, end).trim();

    if (chunk.length > 50) {
      chunks.push(chunk);
    }

    const nextPosition = end - overlap;

    if (nextPosition <= position) {
      position = end;
      if (position >= content.length) {
        break;
      }
    } else {
      position = nextPosition;
    }

    if (position === previousPosition) {
      break;
    }
    previousPosition = position;
  }

  if (chunks.length > 1) {
    return chunks.filter((chunk) => chunk.length > 100);
  }

  return chunks;
}

// Ensure output directories exist
function ensureOutputDirs(outputDir) {
  const dirs = ['jobs', 'skills', 'news', 'general'];
  for (const dir of dirs) {
    const dirPath = path.join(outputDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

// Save documents for a single source to its category folder
function saveSourceFile(outputDir, category, sourceName, documents) {
  const safeName = sourceName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  const filePath = path.join(outputDir, category, `${safeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(documents, null, 2));
  return filePath;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const jobsOnly = args.includes('--jobsOnly');
  const skillsOnly = args.includes('--skillsOnly');
  const newsOnly = args.includes('--newsOnly');

  const outputDirArg = args.find((arg) => arg.startsWith('--outputDir'));
  const outputDir = outputDirArg
    ? outputDirArg.includes('=')
      ? outputDirArg.split('=')[1]
      : args[args.indexOf(outputDirArg) + 1]
    : path.join(__dirname, 'output');

  console.log('');
  console.log('========================================');
  console.log('  Local Web Scraper (Playwright)');
  console.log('  No cloud dependencies - JSON output');
  console.log('========================================');
  console.log('');
  console.log(`Output directory: ${outputDir}`);
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

  ensureOutputDirs(outputDir);

  const results = [];
  const allDocuments = [];
  const startTime = new Date();

  // Process in batches - restart browser every 3 sites
  const batchSize = 3;
  let browser = null;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];

    if (i % batchSize === 0) {
      if (browser) {
        await browser.close();
        browser = null;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-images',
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
        waitForTimeout: 1500,
        maxPages: 10,
      });

      results.push({ ...result, name: target.name });

      if (result.success) {
        const pagesInfo = result.pagesScraped ? ` (${result.pagesScraped} pages)` : '';
        console.log(`  Success: ${result.title}${pagesInfo} (${result.content.length} chars)`);

        const chunks = chunkContent(result.content, 800, 200);
        console.log(`  Created ${chunks.length} chunk(s)`);

        const sourceDocuments = [];

        chunks.forEach((chunk, idx) => {
          try {
            const baseId = result.url.replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
            const docId = `${baseId}-chunk-${idx}`;

            const category = extractCategory(result.title, chunk, result.strategy);
            const sector = extractSector(chunk, result.url);
            const tags = extractTags(chunk, result.title, category, sector);
            const publicationYear = extractPublicationYear(result.title, chunk);

            const doc = {
              id: docId,
              title: result.title,
              content: chunk,
              url: result.url,
              documentId: result.url,
              documentType: 'web',
              source: result.url,
              chunkIndex: idx,
              pageNumber: 1,
              category: category,
              sector: sector,
              tags: tags,
              publicationYear: publicationYear,
              metadata: {
                totalChunks: chunks.length,
                sourceUrl: result.url,
                scrapedAt: new Date().toISOString(),
                strategy: result.strategy,
                pagesScraped: result.pagesScraped || 1,
                dataSource: 'local-scraper',
              },
              scrapedAt: new Date().toISOString(),
            };

            sourceDocuments.push(doc);
            allDocuments.push(doc);
          } catch (chunkError) {
            console.log(`  Error processing chunk ${idx}: ${chunkError.message}`);
          }
        });

        // Save per-source file into category folder
        const category =
          result.strategy === 'jobs'
            ? 'jobs'
            : result.strategy === 'skills'
              ? 'skills'
              : result.strategy === 'news'
                ? 'news'
                : 'general';

        const savedPath = saveSourceFile(outputDir, category, target.name, sourceDocuments);
        console.log(
          `  Saved ${sourceDocuments.length} chunks to ${path.relative(outputDir, savedPath)}`,
        );
      } else {
        console.log(`  Failed: ${result.error}`);
      }
    } catch (error) {
      console.log(`  Error: ${error.message}`);
      results.push({ success: false, error: error.message, url: target.url, name: target.name });
    }
  }

  if (browser) {
    await browser.close();
  }

  // Save combined all-data.json
  const allDataPath = path.join(outputDir, 'all-data.json');
  fs.writeFileSync(allDataPath, JSON.stringify(allDocuments, null, 2));

  // Build and save scrape report
  const endTime = new Date();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const report = {
    timestamp: startTime.toISOString(),
    duration: `${((endTime - startTime) / 1000).toFixed(1)}s`,
    summary: {
      totalTargets: results.length,
      successful: successful.length,
      failed: failed.length,
      totalChunks: allDocuments.length,
    },
    successfulSources: successful.map((r) => ({
      name: r.name,
      url: r.url,
      title: r.title,
      pagesScraped: r.pagesScraped || 1,
      strategy: r.strategy,
    })),
    failedSources: failed.map((r) => ({
      name: r.name,
      url: r.url,
      error: r.error,
    })),
  };

  const reportPath = path.join(outputDir, 'scrape-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Summary
  console.log('');
  console.log('========================================');
  console.log('  Scraping Complete');
  console.log('========================================');
  console.log('');
  console.log(`Successful: ${successful.length}/${results.length}`);
  console.log(`Total chunks: ${allDocuments.length}`);
  console.log(`Duration: ${report.duration}`);
  console.log('');
  console.log(`Output files:`);
  console.log(`  ${allDataPath}`);
  console.log(`  ${reportPath}`);
  console.log(`  + per-source files in ${outputDir}/{jobs,skills,news,general}/`);
  console.log('');
}

// Run
main().catch(console.error);
