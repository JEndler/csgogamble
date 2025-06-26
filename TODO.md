# CS2 HLTV Scraper - TODO List

## Security Issues

### 🔴 High Priority: Dependency Vulnerabilities
**Status**: Open  
**Created**: 2025-06-26  

GitHub Dependabot has identified 22 vulnerabilities in project dependencies:
- 4 high severity
- 14 moderate severity  
- 4 low severity

**Tasks**:
- [ ] Review vulnerability report at https://github.com/JEndler/csgogamble/security/dependabot
- [ ] Update vulnerable dependencies using `poetry update`
- [ ] Test that updated dependencies don't break existing functionality
- [ ] Consider pinning major versions to avoid future breaking changes
- [ ] Set up automated dependency monitoring for future vulnerabilities

**Acceptance Criteria**:
- [ ] All high and moderate severity vulnerabilities resolved
- [ ] Low severity vulnerabilities addressed or documented as acceptable risk
- [ ] Project still builds and runs correctly after updates
- [ ] Updated poetry.lock committed to repository

---

## Infrastructure Setup

### 🔵 Medium Priority: Cloudflare Account & Environment Setup
**Status**: Open  
**Created**: 2025-06-26  

Set up Cloudflare account and configure all necessary services for the scraping infrastructure.

**Browser Setup Tasks**:
- [ ] Create/verify Cloudflare account at https://dash.cloudflare.com
- [ ] Enable Cloudflare Workers (Free tier: 100k requests/day)
- [ ] Enable Cloudflare D1 Database (Free tier: 5M row reads/month)
- [ ] Enable Cloudflare R2 Storage (Free tier: 10GB storage)
- [ ] Enable Cloudflare KV Storage (Free tier: 1GB)
- [ ] Set up custom domain (optional) or use workers.dev subdomain

**API Keys & Tokens**:
- [ ] Generate Cloudflare API Token with permissions:
  - [ ] Zone:Zone:Read (for domain management)
  - [ ] Zone:Zone Settings:Edit
  - [ ] Account:Cloudflare Workers:Edit
  - [ ] Account:D1:Edit
  - [ ] Account:R2:Edit
  - [ ] Account:Workers KV Storage:Edit
- [ ] Save Account ID from dashboard
- [ ] Save Zone ID (if using custom domain)

**Environment Variables to Set**:
```bash
# Cloudflare Configuration
CLOUDFLARE_API_TOKEN=<your_api_token>
CLOUDFLARE_ACCOUNT_ID=<your_account_id>
CLOUDFLARE_ZONE_ID=<your_zone_id>  # Optional: for custom domain

# Database Configuration  
D1_DATABASE_ID=<created_after_setup>

# Storage Configuration
R2_BUCKET_NAME=cs2-scraper-html
KV_NAMESPACE_ID=<created_after_setup>

# Container Configuration (future)
CONTAINER_REGISTRY_URL=<registry_url>
```

**GitHub Secrets to Configure**:
- [ ] Add `CLOUDFLARE_API_TOKEN` to repository secrets
- [ ] Add `CLOUDFLARE_ACCOUNT_ID` to repository secrets
- [ ] Add other environment variables as needed

**Wrangler CLI Setup** (local development):
- [ ] Install Wrangler CLI: `npm install -g wrangler`
- [ ] Login to Cloudflare: `wrangler login`
- [ ] Verify authentication: `wrangler whoami`

**Service Creation**:
- [ ] Create D1 database: `wrangler d1 create cs2-scraper-db`
- [ ] Create R2 bucket: `wrangler r2 bucket create cs2-scraper-html`
- [ ] Create KV namespace: `wrangler kv:namespace create "CS2_SCRAPER_CONFIG"`
- [ ] Note all service IDs for environment configuration

**Documentation**:
- [ ] Document all service IDs and configuration
- [ ] Create `/docs/cloudflare-setup.md` with detailed setup instructions
- [ ] Update CLAUDE.md with Cloudflare development workflow

---

## Development Tasks

### 🟡 Low Priority: Code Quality Setup
**Status**: Open  
**Created**: 2025-06-26  

Implement the code quality tools defined in CLAUDE.md.

**Tasks**:
- [ ] Add Black, Ruff, mypy to pyproject.toml dev dependencies
- [ ] Configure Black settings in pyproject.toml
- [ ] Configure Ruff linting rules
- [ ] Set up mypy type checking configuration
- [ ] Create pre-commit hooks configuration
- [ ] Set up GitHub Actions workflow for code quality checks

**GitHub Actions Workflows**:
- [ ] Code quality checks (linting, formatting, type checking)
- [ ] Dependency vulnerability scanning
- [ ] Container build and push (future)
- [ ] Cloudflare deployment automation (future)

---

## Architecture Migration

### 🟢 Future: Container Setup
**Status**: Planning  
**Created**: 2025-06-26  

Containerize the Python scraping logic for Cloudflare deployment.

**Tasks**:
- [ ] Create multi-stage Dockerfile for optimal image size
- [ ] Set up GitHub Container Registry for image storage
- [ ] Configure container to run as web server with Flask/FastAPI
- [ ] Implement health check endpoints
- [ ] Add structured JSON logging
- [ ] Configure environment-based settings

### 🟢 Future: Worker Development  
**Status**: Planning  
**Created**: 2025-06-26  

Develop Cloudflare Worker for orchestration and scheduling.

**Tasks**:
- [ ] Set up TypeScript/JavaScript Worker project structure
- [ ] Implement cron-triggered scraping jobs
- [ ] Add request routing to container services
- [ ] Implement rate limiting and retry logic
- [ ] Add KV-based configuration management
- [ ] Set up environment-specific deployments (dev/staging/prod)

### 🟢 Future: Database Migration
**Status**: Planning  
**Created**: 2025-06-26  

Migrate from PostgreSQL to Cloudflare D1.

**Tasks**:
- [ ] Design D1 schema matching current PostgreSQL structure
- [ ] Create migration scripts for existing data
- [ ] Update database connector to support D1 API
- [ ] Implement connection pooling and error handling
- [ ] Add database seeding for development

---

## Notes

- **Priority Levels**: 🔴 High (security/blocking) | 🔵 Medium (infrastructure) | 🟡 Low (quality) | 🟢 Future (roadmap)
- **Status Values**: Open | In Progress | Review | Done
- **Update Format**: Add date and brief description when updating tasks

---

*Last Updated: 2025-06-26*