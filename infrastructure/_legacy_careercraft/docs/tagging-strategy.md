# RAG Tagging Strategy for SA Career Hub - Complete Decision Support

This document outlines the comprehensive tagging and data extraction strategy for capturing EVERYTHING needed for decision-making: insights, trends, budgets, policy changes, and market effects.

## Tagging Categories

### 1. Document Categories (Primary Classification)

**PDFs:**

- `budget` - Budget documents, financial allocations, spending breakdowns ⭐ CRITICAL
- `policy` - Government policies, frameworks, policy changes ⭐ CRITICAL
- `strategy` - Strategic plans, roadmaps, workforce strategies
- `trend-report` - Trend analysis, market reports, workforce trends ⭐ CRITICAL
- `insight-report` - Insights, analytics, data analysis ⭐ CRITICAL
- `guideline` - Guidelines, procedures, best practices
- `report` - Research reports, analysis documents
- `legislation` - Legislative documents, acts, regulations
- `form` - Application forms, templates
- `annual-report` - Annual reports and reviews (contains budgets, trends, insights)
- `workforce-plan` - Workforce planning documents (hiring trends, projections)

**Web Content:**

- `job-listing` - Job postings and vacancies
- `career-guidance` - Career advice, pathways
- `training-program` - Training courses, education programs
- `skill-requirement` - Skills lists, competencies
- `occupation-profile` - Occupation descriptions and details
- `migrant-support` - Migrant-specific resources
- `selection-criteria` - Selection criteria examples
- `news-update` - News articles, announcements
- `program-info` - Program information and eligibility

### 2. Sectors (Industry/Government Sectors)

- `health` - Health sector careers and programs
- `education` - Education sector
- `public-sector` - General public sector
- `it-technology` - IT and technology roles
- `finance` - Finance and accounting
- `engineering` - Engineering roles
- `administration` - Administrative roles
- `community-services` - Community and social services
- `transport` - Transport and logistics
- `defense` - Defense and security
- `environment` - Environmental roles

### 3. Topics (Content Themes) - DECISION SUPPORT FOCUS

**Critical Decision Topics:**

- `budget-allocation` - Budget spending, financial allocations ⭐
- `trend-analysis` - Market trends, workforce trends, hiring trends ⭐
- `policy-changes` - Policy updates, regulatory changes ⭐
- `market-insights` - Market analysis, sector insights ⭐
- `workforce-projections` - Future hiring needs, growth projections ⭐
- `sector-growth` - Sector expansion, new programs, opportunities ⭐
- `skill-demand` - In-demand skills, skill shortages ⭐
- `salary-trends` - Salary information, compensation trends ⭐

**Career Support Topics:**

- `job-search` - Job searching strategies
- `interview-prep` - Interview preparation
- `resume-writing` - Resume and CV guidance
- `skill-development` - Skills training and development
- `career-change` - Career transition
- `migration` - Migrant career support
- `qualifications` - Qualifications and certifications
- `selection-criteria` - Selection criteria guidance
- `public-sector-application` - Applying to public sector
- `salary-benefits` - Compensation information
- `workplace-culture` - Workplace information
- `professional-development` - Career growth

### 4. Occupations (Specific Roles)

Extracted from content:

- Examples: `nurse`, `teacher`, `software-engineer`, `accountant`, `project-manager`, etc.
- Should match ANZSCO codes when possible
- Extracted from occupation lists, job descriptions, skill requirements

### 5. Program Types (For Programs/Services)

- `training-program` - Training courses
- `subsidised-training` - Fee-free or subsidised programs
- `job-support` - Job search support services
- `skills-assessment` - Skills recognition programs
- `mentoring` - Mentorship programs
- `networking` - Networking events and programs
- `grant-funding` - Grant and funding opportunities

### 6. Tags (Free-form Additional Tags)

Additional contextual tags:

- `sa-government` - SA government specific
- `federal` - Federal government related
- `regional` - Regional/rural specific
- `graduate` - Graduate programs
- `entry-level` - Entry level positions
- `senior` - Senior roles
- `contract` - Contract positions
- `part-time` - Part-time opportunities
- `full-time` - Full-time positions
- `urgent` - Time-sensitive information
- `updated-2024` - Recent updates
- `new-program` - Newly launched programs

## Tagging Rules

### PDF Documents

1. **Category**: Determine from document structure and title
   - Budget documents → `budget`
   - Strategic plans → `strategy`
   - Policy documents → `policy`

2. **Sector**: Extract from document content
   - Look for department names, sector keywords
   - Health documents → `health`
   - Education documents → `education`

3. **Topics**: Extract from content analysis
   - Use keyword extraction
   - Look for section headers
   - Extract main themes

4. **Occupations**: Extract from occupation lists or job mentions
   - Parse occupation tables
   - Extract from job descriptions

### Web-Scraped Content

1. **Category**: Based on URL pattern and content
   - `/jobs/` → `job-listing`
   - `/careers/` → `career-guidance`
   - `/training/` → `training-program`
   - `/news/` or `/media-releases/` → `news-update`

2. **Sector**: From URL or page metadata
   - `sahealth.sa.gov.au` → `health`
   - `education.sa.gov.au` → `education`

3. **Topics**: Extract from page content and headings
   - Use heading structure
   - Extract key phrases

4. **Occupations**: From job titles or occupation mentions
   - Parse job listing titles
   - Extract from occupation profile pages

## Implementation

### Automatic Tagging (Recommended)

Use Azure OpenAI to analyze content and extract tags:

1. Send document chunk to GPT-4
2. Prompt: "Extract category, sector, topics, occupations, and tags from this SA government career document"
3. Return structured JSON with tags
4. Store in index fields

### Rule-Based Tagging (Fallback)

For faster/cheaper processing:

1. Use keyword matching
2. URL pattern matching for web content
3. File name analysis for PDFs
4. Simple NLP for topic extraction

### Hybrid Approach (Best)

1. Use rules for obvious tags (category from URL, sector from domain)
2. Use AI for complex extraction (topics, occupations from content)
3. Combine results for comprehensive tagging

## Example Tagged Document

```json
{
  "id": "doc-123",
  "content": "...",
  "documentType": "web",
  "source": "scraped",
  "category": "job-listing",
  "sector": "health",
  "tags": ["sa-government", "full-time", "urgent"],
  "topics": ["job-search", "public-sector-application"],
  "occupation": "registered-nurse",
  "programType": null,
  "url": "https://jobs.sa.gov.au/job/12345",
  "title": "Registered Nurse - Emergency Department"
}
```

## Data Extraction for Insights & Visualizations ⭐

### Critical Data Points to Extract:

1. **Budget Data:**
   - Budget amounts, allocations, spending breakdowns
   - Sector-wise budgets (health, education, etc.)
   - Program funding amounts
   - Year-over-year budget changes
   - Extract: Tables, charts, financial figures

2. **Trend Data:**
   - Hiring trends (increasing/decreasing)
   - Sector growth rates
   - Skill demand trends
   - Salary trends over time
   - Extract: Time-series data, percentages, growth rates

3. **Policy Changes:**
   - New policies announced
   - Policy updates/amendments
   - Effective dates
   - Impact areas (sectors, programs)
   - Extract: Policy titles, dates, affected areas

4. **Market Insights:**
   - Sector opportunities
   - In-demand occupations
   - Growth sectors
   - Workforce needs
   - Extract: Lists, rankings, projections

5. **Comparative Data:**
   - Year-over-year comparisons
   - Sector comparisons
   - Program comparisons
   - Extract: Comparison tables, percentages

### Visualization-Ready Data Structure:

```json
{
  "id": "doc-123",
  "content": "...",
  "category": "budget",
  "extractedData": {
    "budgetFigures": [
      { "sector": "health", "amount": 5000000, "year": 2024, "change": "+15%" },
      { "sector": "education", "amount": 3000000, "year": 2024, "change": "+8%" }
    ],
    "trends": [
      { "metric": "hiring-growth", "sector": "health", "value": "+20%", "period": "2023-2024" }
    ],
    "policyChanges": [
      { "policy": "New Training Grants", "date": "2024-01-15", "impact": ["skills", "training"] }
    ]
  }
}
```

## Benefits of Proper Tagging

1. **Better RAG Retrieval**: Filter and prioritize relevant documents
2. **Semantic Search**: Find documents by category/topic, not just keywords
3. **Faceted Search**: Users can filter by sector, occupation, program type
4. **Trend Analysis**: Track trends by category, sector, occupation ⭐
5. **Budget Insights**: Filter by budget documents, extract spending data ⭐
6. **Policy Monitoring**: Track policy changes and their impact ⭐
7. **Market Analysis**: Identify trends, growth sectors, opportunities ⭐
8. **Visualization**: Extract structured data for charts and graphs ⭐
9. **Decision Support**: One-stop solution for all career decision data ⭐
10. **Personalization**: Filter content by user's sector/occupation interests
