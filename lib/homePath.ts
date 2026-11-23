// ─── A dónde va cada persona ─────────────────────────────────────────────────
// Una sola regla para el login y para las redirecciones por rol, así nadie ve
// un instante una página que no le toca (p. ej. el dashboard antes del panel
// de admin).

export interface RoleInfo { role?: string | null; companyId?: string | null }

/** Página de inicio según el rol (y el móvil, que va a /m). */
export function homePathFor(u: RoleInfo, opts: { mobile?: boolean } = {}): string {
  if (opts.mobile) return "/m";
  if (u.role === "admin" || u.role === "support_agent") return "/admindashboard";
  if (u.companyId) return `/companydashboard/${u.companyId}`;
  return "/dashboard";
}

/** Si la persona está en una página que no le corresponde, a dónde debe ir (o null). */
export function roleRedirect(u: RoleInfo, pathname: string): string | null {
  const isAdminPage = pathname.startsWith("/admin");
  const isDashboardPage = pathname === "/dashboard";
  const isCompanyPage = pathname.startsWith("/companydashboard");
  if (u.role === "admin") return isDashboardPage ? "/admindashboard" : null;
  if (u.role === "support_agent") return isDashboardPage || isCompanyPage ? "/admindashboard" : null;
  if (u.companyId) {
    if (isDashboardPage || isAdminPage) return `/companydashboard/${u.companyId}`;
    if (isCompanyPage && pathname.split("/")[2] !== u.companyId) return `/companydashboard/${u.companyId}`;
    return null;
  }
  return isAdminPage || isCompanyPage ? "/dashboard" : null;
}
