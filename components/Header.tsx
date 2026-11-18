"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  ArrowLeftRight,
  Banknote,
  ClipboardList,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  FileSpreadsheet,
  Folder,
  Info,
  LayoutDashboard,
  LogOut,
  Package,
  Receipt,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCOUNTS_NAV = [
  { id: "accounts",        label: "Cuentas",        path: ""                  },
  { id: "journal",         label: "Libro Diario",   path: "journal"            },
  { id: "ledger",          label: "Libro Mayor",    path: "ledger"             },
  { id: "trial-balance",   label: "Sumas y Saldos", path: "trial-balance"     },
  { id: "chart",           label: "Plan Cuentas",   path: "chart-of-accounts" },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function Header() {
  const [profileOpen, setProfileOpen] = useState(false);
  const [envSwitcherOpen, setEnvSwitcherOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [permissions, setPermissions] = useState({
    config: false,
    accounting: false,
    team: false,
  });
  const [accountingAccess, setAccountingAccess] = useState({
    panel: false,
    suppliers: false,
    budget: false,
    users: false,
    reports: false,
    box: false,
  });
  const router   = useRouter();
  const pathname = usePathname();

  // Cerrar los menús al hacer clic en cualquier parte fuera de ellos (o con
  // Escape). No se usa una capa "fixed inset-0": dentro del header, el
  // backdrop-blur la limitaría al propio header.
  const profileRef = useRef<HTMLDivElement>(null);
  const envRef     = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!profileOpen && !envSwitcherOpen) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (profileOpen && !profileRef.current?.contains(target)) setProfileOpen(false);
      if (envSwitcherOpen && !envRef.current?.contains(target)) setEnvSwitcherOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setProfileOpen(false); setEnvSwitcherOpen(false); }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [profileOpen, envSwitcherOpen]);

  // Al cambiar de página, menús cerrados
  useEffect(() => { setProfileOpen(false); setEnvSwitcherOpen(false); }, [pathname]);

  const { user, isLoading } = useUser();
  const userName    = user?.name || "Usuario";
  const userInitial = userName.charAt(0).toUpperCase();
  const isAdmin     = user?.role === "admin";

  const openBudgeting = () => router.push("/budgeting");

  // ── Detect accounts section ──────────────────────────────────────────────
  const accountsMatch = pathname.match(
    /^\/companydashboard\/([^/]+)\/accounts\/([^/]+)(\/.*)?$/
  );
  const isAccountsSection  = !!accountsMatch;
  const accountsProducerId = accountsMatch?.[1] ?? null;
  const accountsProjectId  = accountsMatch?.[2] ?? null;
  const accountsSubPath    = accountsMatch?.[3] ?? "";

  const activeAccountsTab = (() => {
    if (!isAccountsSection) return null;
    const sub = accountsSubPath.replace(/^\//, "").split("/")[0];
    if (sub === "journal")           return "journal";
    if (sub === "ledger")            return "ledger";
    if (sub === "trial-balance")     return "trial-balance";
    if (sub === "chart-of-accounts") return "chart";
    return "accounts";
  })();

  // ── Path detection ────────────────────────────────────────────────────────
  useEffect(() => {
    const pathParts    = pathname.split("/");
    const projectIndex = pathParts.indexOf("project");
    if (projectIndex !== -1 && pathParts[projectIndex + 1]) {
      setProjectId(pathParts[projectIndex + 1]);
    } else {
      setProjectId(null);
      setProjectName("");
    }
  }, [pathname]);

  useEffect(() => {
    const loadProjectName = async () => {
      if (!projectId) { setProjectName(""); return; }
      try {
        const projectDoc = await getDoc(doc(db, "projects", projectId));
        if (projectDoc.exists()) {
          setProjectName(projectDoc.data().name || "Proyecto");
        }
      } catch (error) {
        console.error("Error cargando nombre del proyecto:", error);
      }
    };
    loadProjectName();
  }, [projectId]);

  const [accountsProjectName, setAccountsProjectName] = useState<string>("");
  useEffect(() => {
    const load = async () => {
      if (!accountsProjectId) { setAccountsProjectName(""); return; }
      try {
        const d = await getDoc(doc(db, "projects", accountsProjectId));
        if (d.exists()) setAccountsProjectName(d.data().name || "Proyecto");
      } catch { /* silent */ }
    };
    load();
  }, [accountsProjectId]);

  useEffect(() => {
    const loadPermissions = async () => {
      if (!user?.uid || !projectId) {
        setPermissions({ config: false, accounting: false, team: false });
        setAccountingAccess({ panel: false, suppliers: false, budget: false, users: false, reports: false, box: false });
        return;
      }
      try {
        const userProjectRef  = doc(db, `userProjects/${user.uid}/projects`, projectId);
        const userProjectSnap = await getDoc(userProjectRef);
        if (userProjectSnap.exists()) {
          const d = userProjectSnap.data();
          setPermissions({
            config:     d.permissions?.config     || false,
            accounting: d.permissions?.accounting || false,
            team:       d.permissions?.team       || false,
          });
        }

        const memberRef  = doc(db, `projects/${projectId}/members`, user.uid);
        const memberSnap = await getDoc(memberRef);
        if (memberSnap.exists()) {
          const memberData              = memberSnap.data();
          const hasAccountingPermission = memberData.permissions?.accounting || false;
          if (!hasAccountingPermission) {
            setAccountingAccess({ panel: false, suppliers: false, budget: false, users: false, reports: false, box: false });
            return;
          }
          const accessLevel  = memberData.accountingAccessLevel || "user";
          const boxAccess    = memberData.boxAccess || false;
          const accessLevels = {
            visitor:             { panel: true,  suppliers: false, budget: false, users: false, reports: false },
            user:                { panel: true,  suppliers: true,  budget: false, users: false, reports: false },
            accounting:          { panel: true,  suppliers: true,  budget: false, users: false, reports: true  },
            accounting_extended: { panel: true,  suppliers: true,  budget: true,  users: true,  reports: true  },
          };
          const levelAccess = accessLevels[accessLevel as keyof typeof accessLevels] || accessLevels.user;
          setAccountingAccess({ ...levelAccess, box: boxAccess });
        } else {
          setAccountingAccess({ panel: false, suppliers: false, budget: false, users: false, reports: false, box: false });
        }
      } catch (error) {
        console.error("Error cargando permisos:", error);
        setPermissions({ config: false, accounting: false, team: false });
        setAccountingAccess({ panel: false, suppliers: false, budget: false, users: false, reports: false, box: false });
      }
    };
    loadPermissions();
  }, [user?.uid, projectId]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push("/");
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
    }
  };

  const isAdminSection      = pathname.includes("/admin");
  const isAccountingSection = pathname.includes("/accounting");
  const isTeamSection       = pathname.includes("/team");
  const isConfigSection     = pathname.includes("/config") && !pathname.includes("/accounting/config") && !pathname.includes("/team/");
  const isInProjectSection  = isAccountingSection || isTeamSection || isConfigSection;

  const currentSection = isAdminSection ? "admin"
    : isAccountingSection ? "accounting"
    : isTeamSection ? "team"
    : isConfigSection ? "config"
    : null;

  const accountingPage = isAccountingSection
    ? pathname.includes("/accounting/pos")      ? "pos"
    : pathname.includes("/accounting/invoices") ? "invoices"
    : pathname.includes("/accounting/payments") ? "payments"
    : pathname.includes("/suppliers")  ? "suppliers"
    : pathname.includes("/budget")     ? "budget"
    : pathname.includes("/users") && !pathname.includes("/config/users") ? "users"
    : pathname.includes("/reports")    ? "reports"
    : pathname.includes("/accounting/config") ? "config"
    : "panel"
    : null;

  // ── Team page detection ───────────────────────────────────────────────────
  const teamPage = isTeamSection
    ? pathname.includes("/crew")      ? "crew"
    : pathname.includes("/calendar")  ? "calendar"
    : pathname.includes("/approvals") ? "approvals"
    : pathname.includes("/payroll")   ? "payroll"
    : pathname.includes("/timesheet") ? "timesheet"
    : pathname.includes("/config")    ? "config"
    : "panel"
    : null;

  const configTab = isConfigSection
    ? pathname.includes("/users")       ? "users"
    : pathname.includes("/departments") ? "departments"
    : "general"
    : null;

  // ── Piezas de UI ──────────────────────────────────────────────────────────
  const NavLink = ({ href, isActive, children }: { href: string; isActive: boolean; children: React.ReactNode }) => (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`relative flex h-8 items-center gap-1.5 px-2.5 text-[12.5px] transition-colors ${
        isActive ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-900"
      }`}
    >
      {children}
    </Link>
  );

  // Color propio de cada módulo (punto junto al nombre de la sección)
  const SECTIONS: Record<string, { label: string; color: string }> = {
    accounting: { label: "Contabilidad", color: "#2F52E0" },
    team:       { label: "Equipo",       color: "#6BA319" },
    config:     { label: "Configuración", color: "#64748B" },
  };

  const Separator = () => <span className="select-none text-slate-300">/</span>;

  const Breadcrumb = () => {
    if (isAccountsSection && accountsProjectName) {
      return (
        <div className="flex min-w-0 items-center gap-2.5 text-[12.5px]">
          <Separator />
          <span className="truncate font-medium text-slate-900">{accountsProjectName}</span>
          <Separator />
          <span className="text-slate-500">Contabilidad</span>
        </div>
      );
    }
    if (!isInProjectSection || !projectId || !projectName) return null;
    const section = currentSection ? SECTIONS[currentSection] : null;
    return (
      <div className="flex min-w-0 items-center gap-2.5 text-[12.5px]">
        <Separator />
        <Link href={`/project/${projectId}`} className="flex min-w-0 items-center gap-2 text-slate-900 hover:opacity-75">
          <span className="max-w-[220px] truncate font-medium">{projectName}</span>
        </Link>
        {section && (
          <>
            <Separator />
            <Link href={`/project/${projectId}/${currentSection}`} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: section.color }} />
              {section.label}
            </Link>
          </>
        )}
      </div>
    );
  };

  const iconButton = "flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-[#F1F1F3] hover:text-slate-900";
  const menuItem = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-600 transition-colors hover:bg-[#F7F7F8] hover:text-slate-900";

  return (
    <header className={`fixed left-0 top-0 z-50 w-full border-b border-slate-200/80 bg-white/90 backdrop-blur-md print:hidden ${inter.className}`}>
      <div className="relative flex h-[52px] items-center justify-between px-5">

        {/* Izquierda: logo + ruta */}
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/dashboard" className="flex-shrink-0 select-none">
            <Image src="/logodark.svg" alt="Filma Workspace" width={92} height={22} priority className="h-auto w-[92px]" />
          </Link>
          <Breadcrumb />
        </div>

        {/* Centro: navegación de la sección */}
        <nav className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
          {isAccountsSection && accountsProjectId && ACCOUNTS_NAV.map((n) => {
            const href = `/companydashboard/${accountsProducerId}/accounts/${accountsProjectId}${n.path ? `/${n.path}` : ""}`;
            return <NavLink key={n.id} href={href} isActive={activeAccountsTab === n.id}>{n.label}</NavLink>;
          })}

          {!isAccountsSection && !isAdminSection && !isInProjectSection && (
            <>
              <NavLink href="/dashboard" isActive={pathname === "/dashboard"}>
                <Folder size={14} /> Proyectos
              </NavLink>
              {isAdmin && (
                <NavLink href="/admindashboard" isActive={false}>
                  <Shield size={14} /> Admin
                </NavLink>
              )}
            </>
          )}

          {isAdminSection && (
            <NavLink href="/admindashboard" isActive={true}>
              <Shield size={14} /> Administración
            </NavLink>
          )}

          {isConfigSection && projectId && (
            <>
              <NavLink href={`/project/${projectId}/config`} isActive={configTab === "general"}><Info size={14} /> General</NavLink>
              <NavLink href={`/project/${projectId}/config/users`} isActive={configTab === "users"}><UserCog size={14} /> Usuarios</NavLink>
              <NavLink href={`/project/${projectId}/config/departments`} isActive={configTab === "departments"}><Briefcase size={14} /> Departamentos</NavLink>
            </>
          )}

          {isAccountingSection && projectId && (
            <>
              {accountingAccess.panel     && <NavLink href={`/project/${projectId}/accounting`} isActive={accountingPage === "panel"}><LayoutDashboard size={14} /> Panel</NavLink>}
              {accountingAccess.panel     && <NavLink href={`/project/${projectId}/accounting/pos`} isActive={accountingPage === "pos"}><ClipboardList size={14} /> POs</NavLink>}
              {accountingAccess.panel     && <NavLink href={`/project/${projectId}/accounting/invoices`} isActive={accountingPage === "invoices"}><Receipt size={14} /> Facturas</NavLink>}
              {accountingAccess.budget    && <NavLink href={`/project/${projectId}/accounting/payments`} isActive={accountingPage === "payments"}><Banknote size={14} /> Pagos</NavLink>}
              {accountingAccess.suppliers && <NavLink href={`/project/${projectId}/accounting/suppliers`} isActive={accountingPage === "suppliers"}><Building2 size={14} /> Proveedores</NavLink>}
              {accountingAccess.budget    && <NavLink href={`/project/${projectId}/accounting/budget`} isActive={accountingPage === "budget"}><Wallet size={14} /> Presupuesto</NavLink>}
              {accountingAccess.users     && <NavLink href={`/project/${projectId}/accounting/users`} isActive={accountingPage === "users"}><Users size={14} /> Usuarios</NavLink>}
              {accountingAccess.reports   && <NavLink href={`/project/${projectId}/accounting/reports`} isActive={accountingPage === "reports"}><FileSpreadsheet size={14} /> Informes</NavLink>}
            </>
          )}

          {isTeamSection && projectId && (
            <>
              <NavLink href={`/project/${projectId}/team`} isActive={teamPage === "panel"}><LayoutDashboard size={14} /> Panel</NavLink>
              <NavLink href={`/project/${projectId}/team/crew`} isActive={teamPage === "crew"}><Users size={14} /> Crew</NavLink>
              <NavLink href={`/project/${projectId}/team/calendar`} isActive={teamPage === "calendar"}><Calendar size={14} /> Calendario</NavLink>
              <NavLink href={`/project/${projectId}/team/payroll`} isActive={teamPage === "payroll"}><Banknote size={14} /> Nóminas</NavLink>
              <NavLink href={`/project/${projectId}/team/timesheet`} isActive={teamPage === "timesheet"}><Clock size={14} /> Control horario</NavLink>
            </>
          )}
        </nav>

        {/* Derecha */}
        <div className="relative flex items-center gap-1.5">
          {/* Cajas (BOX) */}
          {isAccountingSection && projectId && accountingAccess.box && (
            <Link href={`/project/${projectId}/accounting/box`} className={iconButton} title="Cajas">
              <Package size={16} />
            </Link>
          )}

          {/* Cambiar de entorno dentro del proyecto */}
          {isInProjectSection && projectId && (() => {
            const envs = [
              permissions.config     && { key: "config",     icon: Settings, href: `/project/${projectId}/config` },
              permissions.accounting && { key: "accounting", icon: Receipt,  href: `/project/${projectId}/accounting` },
              permissions.team       && { key: "team",       icon: Users,    href: `/project/${projectId}/team` },
            ].filter(Boolean) as { key: string; icon: any; href: string }[];
            const otherEnvs = envs.filter((env) => env.key !== currentSection);
            if (envs.length <= 1 || otherEnvs.length === 0) return null;
            return (
              <div className="relative" ref={envRef}>
                <button onClick={() => setEnvSwitcherOpen(!envSwitcherOpen)} className={iconButton} title="Cambiar de módulo">
                  <ArrowLeftRight size={16} />
                </button>
                {envSwitcherOpen && (
                  <div className="animate-fadeIn absolute right-0 top-full z-50 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                    {otherEnvs.map((env) => {
                      const Icon = env.icon;
                      const section = SECTIONS[env.key];
                      return (
                        <Link key={env.key} href={env.href} onClick={() => setEnvSwitcherOpen(false)} className={menuItem}>
                          <Icon size={15} style={{ color: section.color }} />
                          {section.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Budgeting (solo en el panel de proyectos) */}
          {user?.budgetingAccess && pathname === "/dashboard" && (
            <button
              onClick={openBudgeting}
              className="flex h-8 items-center justify-center rounded-lg px-2.5 transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #ED8C6E, #E86F4A)" }}
              title="Budgeting"
            >
              <Image src="/logo-budgeting-white.svg" alt="Budgeting" width={26} height={8} className="h-2.5 w-auto" />
            </button>
          )}

          {/* Perfil */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-full border border-[#E4E4E7] bg-[#F1F1F3] text-xs font-semibold text-slate-700 transition-colors hover:bg-[#E8E8EB]"
              aria-label="Menú de usuario"
            >
              {userInitial}
            </button>
            {profileOpen && (
              <div className="animate-fadeIn absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                <div className="px-2.5 pb-2 pt-1.5">
                  <p className="truncate text-[13px] font-medium text-slate-900">{userName}</p>
                  {user?.email && <p className="truncate text-xs text-slate-500">{user.email}</p>}
                </div>
                <div className="my-1 border-t border-slate-100" />
                {isAdmin && (
                  <Link href="/admindashboard" className={menuItem} onClick={() => setProfileOpen(false)}>
                    <Shield size={15} /> Administración
                  </Link>
                )}
                <Link href="/profile" className={menuItem} onClick={() => setProfileOpen(false)}>
                  <User size={15} /> Mi cuenta
                </Link>
                <div className="my-1 border-t border-slate-100" />
                <button onClick={handleLogout} className={`${menuItem} hover:!bg-red-50 hover:!text-red-600`}>
                  <LogOut size={15} /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        :global(.animate-fadeIn) { animation: fadeIn 0.12s ease-out; }
      `}</style>
    </header>
  );
}
