# AI ALCHEMY Coding Standards

## Purpose & Principles

- **Consistent developer experience** and predictable code patterns
- **TypeScript-first**: Security, accessibility, and performance by default
- **Feature-first structure**: Co-locate code with the feature
- **Automate enforcement**: Use linters, formatters, and CI quality gates

## Code Quality Standards

### TypeScript Requirements

- **Strict Mode**: All code must use TypeScript with strict type checking
- **No `any` Types**: Avoid `any` unless absolutely unavoidable
- **Explicit Types**: Provide explicit types for all variables, functions, and interfaces
- **Error Handling**: Always use proper error types and handle errors explicitly

### Code Organization

- **File Naming**: camelCase for all files, including React components
- **Type Definitions**: Colocate with `*.types.ts` pattern (e.g., `doc.ingest.types.ts`)
- **Test Files**: Colocate with source files using `.test.ts` suffix
- **Function Complexity**: Keep functions small and focused (cyclomatic complexity <7)
- **File Size**: Avoid overly large files; split logically into multiple files

### Documentation

- **Code Comments**: Add comments wherever applicable and jsdocs for public APIs
- **API Documentation**: Document all public APIs and interfaces
- **README Files**: Include README.md for each service with setup instructions

## Naming Conventions

### Files and Directories

- **Global Rule**: All file names use camelCase
- **React Components**: `componentName.tsx`
- **Hooks**: `useThing.ts`
- **Utilities**: `camelCase.ts` (e.g., `formatCurrency.ts`)
- **Types**: `componentName.types.ts` (colocated)
- **Constants**: `feature.constants.ts` with SCREAMING_SNAKE_CASE exports
- **Tests**: `.test.ts` for unit tests, `.spec.ts` for E2E tests
- **Stories**: `componentName.stories.tsx` (colocated)

### Variables and Functions

- **Variables**: camelCase, descriptive names, include units (e.g., `timeoutMs`)
- **Functions**: camelCase, verb-based names
- **Classes**: PascalCase
- **Interfaces**: PascalCase, descriptive names
- **Constants**: SCREAMING_SNAKE_CASE
- **Enums**: PascalCase

### API Endpoints

- **RESTful**: Use standard HTTP methods and resource-based URLs
- **Status Codes**: Semantic codes (200, 201, 400, 401, 404, 422, 500)
- **Error Format**: `{ error: string, code: string, details?: any }`

## API Development Standards

### Backend API Patterns

- **Framework**: Express.js with TypeScript
- **Validation**: Zod schemas for request/response validation
- **Middleware**: Use middleware for cross-cutting concerns
- **Health Endpoints**: Include `/health` for all HTTP services
- **CORS**: Configure CORS appropriately
- **Security Headers**: Apply security headers to all services

### Frontend API Integration

- **Route Handlers**: Use Next.js Route Handlers in `app/api/.../route.ts`
- **Server Components**: Prefer RSC for data fetching
- **Client State**: Use Zustand for client-side state management
- **Streaming**: Implement Server-Sent Events for real-time responses

### Error Handling

- **Consistent Format**: Standardized error response structure
- **Error Boundaries**: Implement error boundaries for React components
- **Logging**: Use structured logging with correlation IDs
- **User Feedback**: Provide clear error messages and recovery options

## Component Development Standards

### React Components

- **Functional Components**: Use functional components only
- **Server Components**: Prefer RSC for data-fetching UI
- **Props Interface**: Define clear props interfaces with TypeScript
- **Default Props**: Use default parameter values for optional props
- **Children Props**: Use React.ReactNode for flexible content
- **Conditional Rendering**: Prefer ternaries over `&&` in JSX

### Component Architecture

- **Composition**: Prefer composition over inheritance
- **Extract Logic**: Move logic into hooks or utility functions
- **Reusability**: Create reusable components in shared libraries
- **Accessibility**: Meet WCAG 2.2 AA standards where feasible

### Styling Standards

- **Tailwind CSS**: Use utility classes by default
- **Component Styles**: Use `componentName.css` when needed
- **Responsive Design**: Use responsive prefixes (sm:, md:, lg:, xl:)
- **Dark Mode**: Implement dark mode with CSS variables
- **Theme System**: Use established theme provider patterns

## State Management

### Backend State

- **Stateless Services**: Keep services stateless where possible
- **Session Management**: Use proper session handling
- **Caching**: Implement appropriate caching strategies

### Frontend State

- **Zustand Stores**: Organize stores by domain (auth, chat, documents)
- **Server State**: Prefer RSC patterns over client-side caching
- **Persistence**: Implement persistence for critical state
- **Selectors**: Use selectors for derived state

## Testing Requirements

### Testing Structure

- **Colocated Tests**: Place test files alongside source files
- **Test Naming**: Use descriptive test names
- **AAA Pattern**: Arrange-Act-Assert structure
- **Mocking**: Mock external dependencies appropriately

### Test Types

- **Unit Tests**: Test individual functions and components
- **Integration Tests**: Test component interactions and API endpoints
- **E2E Tests**: Test complete user workflows
- **Accessibility Tests**: Ensure components meet accessibility standards

## Security Standards

### Input Validation

- **Boundary Validation**: Validate all external inputs/outputs at boundaries
- **Zod Schemas**: Use Zod for runtime validation
- **Sanitization**: Sanitize HTML content when rendering

### Authentication & Authorization

- **Session Management**: Implement proper session handling
- **Route Protection**: Protect sensitive routes with middleware
- **Authorization**: Implement proper authorization checks

### Security Headers

- **CSP**: Apply Content Security Policy
- **Security Headers**: Use Next.js security headers
- **Dependency Scanning**: Run dependency scans in CI
- **Secrets Management**: Use proper environment variable handling

## Performance Standards

### Backend Performance

- **Database Optimization**: Optimize database queries
- **Caching**: Implement appropriate caching strategies
- **Connection Pooling**: Use connection pooling for databases
- **Monitoring**: Implement performance monitoring

### Frontend Performance

- **Code Splitting**: Use dynamic imports and route splitting
- **Image Optimization**: Use Next.js Image component
- **Lazy Loading**: Implement lazy loading for non-critical components
- **Bundle Analysis**: Use Next.js analyzer for bundle optimization

### General Performance

- **Function Complexity**: Keep functions small and focused
- **Memory Management**: Avoid memory leaks
- **Async Operations**: Use proper async/await patterns
- **Error Handling**: Implement proper error handling

## Development Workflow

### Code Quality Tools

- **Linting**: Biome.js for linting and formatting
- **Type Checking**: TypeScript strict mode
- **CI/CD**: Automated quality gates in CI pipeline

### Git Workflow

- **Branching**: Use feature branches for development
- **Commits**: Use conventional commit messages
- **Pull Requests**: Require code reviews and quality checks
- **Merge**: Block merge on CI failures

### Environment Management

- **Environment Variables**: Use proper environment variable handling
- **Configuration**: Centralize configuration with validation
- **Secrets**: Use secrets management in production
- **Local Development**: Use .env files for local development

## Deployment Standards

### Backend Deployment

- **Docker**: Use Docker for containerization
- **Health Checks**: Implement Docker health checks
- **Logging**: Use structured logging with correlation IDs
- **Monitoring**: Implement application monitoring

### Frontend Deployment

- **Static Generation**: Use static generation where possible
- **ISR**: Implement Incremental Static Regeneration
- **CDN**: Use CDN for static assets
- **Performance**: Monitor Core Web Vitals

### Infrastructure

- **Container Orchestration**: Use appropriate orchestration platform
- **Service Discovery**: Implement service discovery
- **Load Balancing**: Use load balancing for high availability
- **Monitoring**: Implement comprehensive monitoring

## CI/CD Quality Gates

### Pull Request Checks

- **Biome Check**: Linting and formatting validation
- **Unit Tests**: Run all unit tests
- **Build Check**: Verify successful builds
- **Type Check**: TypeScript compilation check
- **Security Scan**: Dependency vulnerability scan

### Merge Requirements

- **Code Review**: Require code review approval
- **Quality Gates**: Block merge on CI failures
- **Test Coverage**: Maintain minimum test coverage
- **Documentation**: Ensure documentation is updated

### Artifacts

- **Build Artifacts**: Store build artifacts
- **Test Reports**: Store test reports and coverage
- **Deployment**: Automated deployment on merge
- **Monitoring**: Set up monitoring and alerting
