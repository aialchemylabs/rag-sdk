/**
 * Identifies the caller for tenant-scoped access control.
 * Passed to retrieval and answering to enforce per-tenant collection isolation.
 */
export interface SecurityContext {
	tenantId: string;
	domainId?: string;
	userId?: string;
	workspaceId?: string;
}
