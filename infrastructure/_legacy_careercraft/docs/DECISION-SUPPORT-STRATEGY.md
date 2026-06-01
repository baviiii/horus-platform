# Complete Decision Support Strategy - One-Stop Solution

## Goal: Capture EVERYTHING for Decision-Making

Users need to see **insights, trends, budgets, policy changes, and market effects** in one place to make informed career decisions.

## What We Capture

### 1. Budget Data 💰

- **Financial allocations** by sector (health, education, etc.)
- **Program funding** amounts
- **Year-over-year changes** (growth/decline percentages)
- **Spending breakdowns** (where money is going)

**Visualization**: Budget charts, sector comparisons, funding trends

### 2. Trends 📈

- **Hiring trends** (increasing/decreasing roles)
- **Sector growth rates** (which sectors are expanding)
- **Skill demand trends** (what's in demand)
- **Salary trends** (compensation changes)
- **Workforce projections** (future needs)

**Visualization**: Trend lines, growth charts, projections

### 3. Policy Changes 📋

- **New policies** announced
- **Policy updates/amendments**
- **Effective dates**
- **Impact areas** (which sectors/programs affected)

**Visualization**: Timeline, policy cards, impact matrix

### 4. Market Insights 🔍

- **Sector opportunities** (growing sectors)
- **In-demand occupations** (high-demand roles)
- **Growth sectors** (expanding areas)
- **Skill shortages** (where help is needed)

**Visualization**: Opportunity maps, demand heatmaps, sector comparisons

### 5. Comparative Data 📊

- **Year-over-year comparisons** (budgets, hiring, trends)
- **Sector comparisons** (health vs education, etc.)
- **Program comparisons** (which programs get more funding)
- **Occupational comparisons** (demand by role)

**Visualization**: Comparison charts, bar graphs, tables

## Data Extraction Flow

```
Document (PDF/Web)
    ↓
Extract Content
    ↓
Tag Document (category, sector, topics, occupation)
    ↓
Extract Structured Data (budgets, trends, policies, insights)
    ↓
Store in Azure AI Search (with tags + extracted data)
    ↓
Query with Filters (budget documents, trends, policies)
    ↓
Return Structured Data for Visualizations
    ↓
Display: Charts, Graphs, Tables, Insights Dashboard
```

## Query Examples

### Get Budget Insights:

```
Query: "budget allocations health sector 2024"
Filter: category eq 'budget' and sector eq 'health'
Return: Budget figures, comparisons, trends
Visualize: Budget charts, sector breakdowns
```

### Get Hiring Trends:

```
Query: "hiring trends software engineer"
Filter: topics/any(t: t eq 'trend-analysis') and occupation eq 'software-engineer'
Return: Trend data, growth percentages, projections
Visualize: Trend lines, growth charts
```

### Get Policy Changes:

```
Query: "new training programs announced"
Filter: category eq 'policy' and topics/any(t: t eq 'policy-changes')
Return: Policy details, dates, impact areas
Visualize: Timeline, policy cards
```

### Get Market Insights:

```
Query: "in-demand skills 2024"
Filter: topics/any(t: t eq 'market-insights' or t eq 'skill-demand')
Return: Skills lists, demand data, opportunities
Visualize: Demand heatmap, opportunity list
```

## Visualization Requirements

### Dashboard Components Needed:

1. **Budget Dashboard**
   - Sector-wise budget breakdown (pie chart)
   - Year-over-year budget changes (bar chart)
   - Program funding amounts (horizontal bar chart)

2. **Trends Dashboard**
   - Hiring trend lines by sector (line chart)
   - Skill demand trends (area chart)
   - Growth projections (forecast chart)

3. **Policy Timeline**
   - Chronological policy changes (timeline view)
   - Impact areas per policy (matrix view)
   - Recent announcements (cards)

4. **Market Insights**
   - Opportunity heatmap by sector/occupation
   - In-demand occupations list (ranking)
   - Growth sectors comparison (bar chart)

5. **Comparative Analysis**
   - Sector comparisons (multi-bar chart)
   - Year-over-year comparisons (side-by-side charts)
   - Program comparisons (table with charts)

## Implementation

### Edge Functions:

1. **rag-tag-documents** - Tags documents (category, sector, topics)
2. **rag-extract-insights** - Extracts structured data (budgets, trends, policies)

### Frontend Components:

1. **Insights Dashboard** - Main dashboard with all visualizations
2. **Budget Viewer** - Budget-specific charts and tables
3. **Trends Analyzer** - Trend visualizations
4. **Policy Monitor** - Policy changes timeline
5. **Market Insights** - Opportunities and demand visualizations

### Data Flow:

```
User Query → RAG Search (filtered by tags) → Get Documents + Extracted Data →
Format for Visualization → Display Charts/Graphs/Tables
```

## Key Features

✅ **One-Stop Solution**: All decision data in one place
✅ **Visual**: Easy-to-understand charts and graphs
✅ **Filtered**: Find exactly what you need (by sector, category, topic)
✅ **Structured**: Data extracted and ready for visualization
✅ **Comprehensive**: Budgets, trends, policies, insights, comparisons
✅ **Real-time**: Auto-updates every 6 hours from web scraping

## Success Criteria

Users should be able to:

1. **See budget breakdowns** by sector at a glance
2. **Understand trends** with visual charts
3. **Track policy changes** and their impact
4. **Identify opportunities** (growing sectors, in-demand roles)
5. **Make decisions** based on comprehensive data

This is a **complete decision support system** - not just search, but insights, trends, and visualizations for informed career decisions.
