"use client";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Menu,
  X,
  Users,
  LogOut,
  Settings,
  Folder,
  LayoutDashboard,
  Wallet,
  Briefcase,
  Info,
  UserCog,
  Building2,
  Shield,
  User,
  FileText,
  Receipt,
  FileSpreadsheet,
  ArrowLeftRight,
  BarChart3,
  Package,
} from "lucide-react";
import { Inter } from "next/font/google";
import { auth, db } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
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
  });
  const router = useRouter();
  const pathname = usePathname();
  
  const { user, isLoading } = useUser();
  const userName = user?.name || "Usuario";
  const userInitial = userName.charAt(0).toUpperCase();
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    const pathParts = pathname.split("/");
    const projectIndex = pathParts.indexOf("project");
    if (projectIndex !== -1 && pathParts[projectIndex + 1]) {
      setProjectId(pathParts[projectIndex + 1]);
    } else {
      setProjectId(null);
      setProjectName("");
    }
  }, [pathname]);

  // Cargar nombre del proyecto
  useEffect(() => {
    const loadProjectName = async () => {
      if (!projectId) {
        setProjectName("");
        return;
      }
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

  useEffect(() => {
    const loadPermissions = async () => {
      if (!user?.uid || !projectId) {
        setPermissions({ config: false, accounting: false, team: false });
        setAccountingAccess({ panel: false, suppliers: false, budget: false, users: false, reports: false });
        return;
      }

      try {
        const userProjectRef = doc(db, `userProjects/${user.uid}/projects`, projectId);
        const userProjectSnap = await getDoc(userProjectRef);

        if (userProjectSnap.exists()) {
          const userProjectData = userProjectSnap.data();
          setPermissions({
            config: userProjectData.permissions?.config || false,
            accounting: userProjectData.permissions?.accounting || false,
            team: userProjectData.permissions?.team || false,
          });
        }

        const memberRef = doc(db, `projects/${projectId}/members`, user.uid);
        const memberSnap = await getDoc(memberRef);

        if (memberSnap.exists()) {
          const memberData = memberSnap.data();
          const hasAccountingPermission = memberData.permissions?.accounting || false;

          if (!hasAccountingPermission) {
            setAccountingAccess({ panel: false, suppliers: false, budget: false, users: false, reports: false });
            return;
          }

          const accessLevel = memberData.accountingAccessLevel || "user";
          const accessLevels = {
            visitor: { panel: true, suppliers: false, budget: false, users: false, reports: false },
            user: { panel: true, suppliers: true, budget: false, users: false, reports: false },
            accounting: { panel: true, suppliers: true, budget: false, users: false, reports: true },
            accounting_extended: { panel: true, suppliers: true, budget: true, users: true, reports: true },
          };

          setAccountingAccess(accessLevels[accessLevel as keyof typeof accessLevels] || accessLevels.user);
        } else {
          setAccountingAccess({ panel: false, suppliers: false, budget: false, users: false, reports: false });
        }
      } catch (error) {
        console.error("Error cargando permisos:", error);
        setPermissions({ config: false, accounting: false, team: false });
        setAccountingAccess({ panel: false, suppliers: false, budget: false, users: false, reports: false });
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

  const isAdminSection = pathname.includes("/admin");
  const isAccountingSection = pathname.includes("/accounting");
  const isTeamSection = pathname.includes("/team") && !pathname.includes("/config");
  const isConfigSection = pathname.includes("/config");
  const isInProjectSection = isAccountingSection || isTeamSection || isConfigSection;

  const currentSection = isAdminSection ? "admin" : isAccountingSection ? "accounting" : isTeamSection ? "team" : isConfigSection ? "config" : null;

  const accountingPage = isAccountingSection
    ? pathname.includes("/suppliers")
      ? "suppliers"
      : pathname.includes("/budget")
      ? "budget"
      : pathname.includes("/users")
      ? "users"
      : pathname.includes("/reports")
      ? "reports"
      : pathname.includes("/config")
      ? "config"
      : "panel"
    : null;

  const configTab = isConfigSection ? (pathname.includes("/users") ? "users" : pathname.includes("/departments") ? "departments" : "general") : null;

  // NavLink con fondo sutil redondeado
  const NavLink = ({ href, isActive, children }: { href: string; isActive: boolean; children: React.ReactNode }) => (
    <Link
      href={href}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all ${
        isActive 
          ? "text-slate-900 bg-slate-100 font-medium" 
          : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );

  // Badge del proyecto con sección actual
  const ProjectBadge = () => {
    if (!isInProjectSection || !projectId || !projectName) return null;

    return (
      <div className="hidden md:flex items-center gap-2 text-xs">
        <span className="text-slate-300">·</span>
        <Link 
          href={`/project/${projectId}`}
          className="text-slate-600 font-medium uppercase hover:text-slate-900 transition-colors"
        >
          {projectName}
        </Link>
      </div>
    );
  };

  // Section Switcher con iconos - ELIMINADO

  return (
    <header className={`fixed top-0 left-0 w-full z-50 bg-white border-b border-slate-200 ${inter.className}`}>
      <div className="px-6 py-2.5 flex items-center justify-between">
        {/* Left: Logo + Project Badge */}
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="select-none flex-shrink-0">
            <Image
              src="/logodark.svg"
              alt="Logo"
              width={100}
              height={24}
              priority
            />
          </Link>
          <ProjectBadge />
        </div>

        {/* Center: Navigation - Desktop */}
        <nav className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
          {/* Default Menu */}
          {!isAdminSection && !isAccountingSection && !isTeamSection && !isConfigSection && (
            <>
              <NavLink href="/dashboard" isActive={pathname === "/dashboard"}>
                <Folder size={14} />
                <span>Proyectos</span>
              </NavLink>
              {isAdmin && (
                <NavLink href="/admin" isActive={false}>
                  <Shield size={14} />
                  <span>Admin</span>
                </NavLink>
              )}
            </>
          )}

          {/* Admin Menu */}
          {isAdminSection && (
            <NavLink href="/admin" isActive={true}>
              <Shield size={14} />
              <span>Panel de administración</span>
            </NavLink>
          )}

          {/* Config Menu */}
          {isConfigSection && projectId && (
            <>
              <NavLink href={`/project/${projectId}/config`} isActive={configTab === "general"}>
                <Info size={14} />
                <span>General</span>
              </NavLink>
              <NavLink href={`/project/${projectId}/config/users`} isActive={configTab === "users"}>
                <UserCog size={14} />
                <span>Usuarios</span>
              </NavLink>
              <NavLink href={`/project/${projectId}/config/departments`} isActive={configTab === "departments"}>
                <Briefcase size={14} />
                <span>Departamentos</span>
              </NavLink>
            </>
          )}

          {/* Accounting Menu */}
          {isAccountingSection && projectId && (
            <>
              {accountingAccess.panel && (
                <NavLink href={`/project/${projectId}/accounting`} isActive={accountingPage === "panel"}>
                  <LayoutDashboard size={14} />
                  <span>Panel</span>
                </NavLink>
              )}
              {accountingAccess.suppliers && (
                <NavLink href={`/project/${projectId}/accounting/suppliers`} isActive={accountingPage === "suppliers"}>
                  <Building2 size={14} />
                  <span>Proveedores</span>
                </NavLink>
              )}
              {accountingAccess.budget && (
                <NavLink href={`/project/${projectId}/accounting/budget`} isActive={accountingPage === "budget"}>
                  <Wallet size={14} />
                  <span>Presupuesto</span>
                </NavLink>
              )}
              {accountingAccess.users && (
                <NavLink href={`/project/${projectId}/accounting/users`} isActive={accountingPage === "users"}>
                  <Users size={14} />
                  <span>Usuarios</span>
                </NavLink>
              )}
              {accountingAccess.reports && (
                <NavLink href={`/project/${projectId}/accounting/reports`} isActive={accountingPage === "reports"}>
                  <FileSpreadsheet size={14} />
                  <span>Informes</span>
                </NavLink>
              )}
            </>
          )}

          {/* Team Menu */}
          {isTeamSection && projectId && (
            <NavLink href={`/project/${projectId}/team`} isActive={true}>
              <Users size={14} />
              <span>Equipo</span>
            </NavLink>
          )}
        </nav>

        {/* Right side: BOX + Environment Switcher + Profile */}
        <div className="relative flex items-center gap-2">
          {/* BOX Icon - Solo visible en sección accounting */}
          {isAccountingSection && projectId && permissions.accounting && (
            <Link
              href={`/project/${projectId}/accounting/boxes`}
              className="hidden md:flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 shadow-sm hover:shadow-md hover:scale-105 transition-all"
              title="Cajas (BOX)"
            >
              <Package size={14} className="text-white" />
            </Link>
          )}

          {/* Environment Switcher - Solo visible si estamos en un proyecto y hay más de un entorno disponible */}
          {isInProjectSection && projectId && (() => {
            const availableEnvs = [
              permissions.config && { 
                key: "config", 
                icon: Settings, 
                href: `/project/${projectId}/config`, 
                bg: "bg-slate-100", 
                color: "text-slate-600",
                hoverBg: "hover:bg-slate-200"
              },
              permissions.accounting && { 
                key: "accounting", 
                icon: BarChart3, 
                href: `/project/${projectId}/accounting`, 
                bg: "bg-[rgba(47,82,224,0.1)]", 
                color: "text-[#2F52E0]",
                hoverBg: "hover:bg-[rgba(47,82,224,0.15)]"
              },
              permissions.team && { 
                key: "team", 
                icon: Users, 
                href: `/project/${projectId}/team`, 
                bg: "bg-[rgba(137,211,34,0.15)]", 
                color: "text-[#6BA319]",
                hoverBg: "hover:bg-[rgba(137,211,34,0.25)]"
              },
            ].filter(Boolean) as { key: string; icon: any; href: string; bg: string; color: string; hoverBg: string }[];
            
            // Solo mostrar si hay más de un entorno disponible
            if (availableEnvs.length <= 1) return null;
            
            const otherEnvs = availableEnvs.filter(env => env.key !== currentSection);
            if (otherEnvs.length === 0) return null;

            return (
              <div className="relative hidden md:block">
                <button
                  onClick={() => setEnvSwitcherOpen(!envSwitcherOpen)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Cambiar entorno"
                >
                  <ArrowLeftRight size={15} />
                </button>
                
                {envSwitcherOpen && <div className="fixed inset-0 z-40" onClick={() => setEnvSwitcherOpen(false)}></div>}
                
                {envSwitcherOpen && (
                  <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-50 flex gap-1">
                    {otherEnvs.map((env) => {
                      const Icon = env.icon;
                      return (
                        <Link
                          key={env.key}
                          href={env.href}
                          onClick={() => setEnvSwitcherOpen(false)}
                          className={`w-8 h-8 rounded-lg ${env.bg} ${env.hoverBg} flex items-center justify-center transition-colors`}
                          title={env.key.charAt(0).toUpperCase() + env.key.slice(1)}
                        >
                          <Icon size={14} className={env.color} />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Profile Avatar */}
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            {userInitial}
          </button>

          {profileOpen && <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)}></div>}

          {profileOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-xs z-50 animate-fadeIn">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="font-medium text-slate-900 truncate">{userName}</p>
                {isAdmin && (
                  <span className="inline-block mt-1 text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                    Admin
                  </span>
                )}
              </div>
              {isAdmin && (
                <Link href="/admin" className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition" onClick={() => setProfileOpen(false)}>
                  <Shield size={13} />
                  Administración
                </Link>
              )}
              <Link href="/profile" className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition" onClick={() => setProfileOpen(false)}>
                <User size={13} />
                Mi cuenta
              </Link>
              <div className="border-t border-slate-100 my-0.5" />
              <button onClick={handleLogout} className="flex w-full items-center gap-2 px-3 py-2 text-slate-600 hover:text-red-600 hover:bg-red-50 text-left transition">
                <LogOut size={13} />
                Cerrar sesión
              </button>
            </div>
          )}

          {/* Mobile Menu Button */}
          <button 
            className="md:hidden p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="md:hidden bg-white border-t border-slate-100">
          <nav className="flex flex-col p-2 gap-0.5">
            {/* Project Badge - Mobile */}
            {isInProjectSection && projectId && projectName && (
              <>
                <div className="px-3 py-2 mb-1">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
                    <Link 
                      href={`/project/${projectId}`}
                      onClick={() => setMenuOpen(false)}
                      className="text-slate-900 font-semibold uppercase hover:text-slate-700"
                    >
                      {projectName}
                    </Link>
                    <span className="text-slate-300">·</span>
                    <div className="flex items-center gap-1">
                      {permissions.config && (
                        <Link
                          href={`/project/${projectId}/config`}
                          onClick={() => setMenuOpen(false)}
                          className={currentSection === "config" ? "text-slate-900 font-semibold" : "text-slate-500"}
                        >
                          Config
                        </Link>
                      )}
                      {permissions.config && (permissions.accounting || permissions.team) && (
                        <span className="text-slate-300">/</span>
                      )}
                      {permissions.accounting && (
                        <Link
                          href={`/project/${projectId}/accounting`}
                          onClick={() => setMenuOpen(false)}
                          className={currentSection === "accounting" ? "text-slate-900 font-semibold" : "text-slate-500"}
                        >
                          Accounting
                        </Link>
                      )}
                      {permissions.accounting && permissions.team && (
                        <span className="text-slate-300">/</span>
                      )}
                      {permissions.team && (
                        <Link
                          href={`/project/${projectId}/team`}
                          onClick={() => setMenuOpen(false)}
                          className={currentSection === "team" ? "text-slate-900 font-semibold" : "text-slate-500"}
                        >
                          Team
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
                <div className="border-t border-slate-100 my-1"></div>
                <p className="px-3 py-1 text-[10px] text-slate-400 uppercase tracking-wider">En esta sección</p>
              </>
            )}

            {!isAdminSection && !isAccountingSection && !isTeamSection && !isConfigSection ? (
              <>
                <Link href="/dashboard" onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${pathname === "/dashboard" ? "text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                  <Folder size={14} />
                  Proyectos
                </Link>
                {isAdmin && (
                  <Link href="/admin" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50">
                    <Shield size={14} />
                    Administración
                  </Link>
                )}
                <div className="border-t border-slate-100 my-1"></div>
                <Link href="/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50">
                  <User size={14} />
                  Mi cuenta
                </Link>
                <button onClick={() => { setMenuOpen(false); handleLogout(); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 text-left">
                  <LogOut size={14} />
                  Cerrar sesión
                </button>
              </>
            ) : isAdminSection ? (
              <>
                <Link href="/admin" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50">
                  <Shield size={14} />
                  Panel de administración
                </Link>
                <div className="border-t border-slate-100 my-1"></div>
                <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50">
                  <Folder size={14} />
                  Proyectos
                </Link>
                <Link href="/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50">
                  <User size={14} />
                  Mi cuenta
                </Link>
                <button onClick={() => { setMenuOpen(false); handleLogout(); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 text-left">
                  <LogOut size={14} />
                  Cerrar sesión
                </button>
              </>
            ) : isConfigSection ? (
              <>
                <Link href={`/project/${projectId}/config`} onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${configTab === "general" ? "text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                  <Info size={14} />
                  General
                </Link>
                <Link href={`/project/${projectId}/config/users`} onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${configTab === "users" ? "text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                  <UserCog size={14} />
                  Usuarios
                </Link>
                <Link href={`/project/${projectId}/config/departments`} onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${configTab === "departments" ? "text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                  <Briefcase size={14} />
                  Departamentos
                </Link>
                <div className="border-t border-slate-100 my-1"></div>
                <button onClick={() => { setMenuOpen(false); handleLogout(); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 text-left">
                  <LogOut size={14} />
                  Cerrar sesión
                </button>
              </>
            ) : isAccountingSection ? (
              <>
                {accountingAccess.panel && (
                  <Link href={`/project/${projectId}/accounting`} onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${accountingPage === "panel" ? "text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                    <LayoutDashboard size={14} />
                    Panel
                  </Link>
                )}
                {accountingAccess.suppliers && (
                  <Link href={`/project/${projectId}/accounting/suppliers`} onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${accountingPage === "suppliers" ? "text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                    <Building2 size={14} />
                    Proveedores
                  </Link>
                )}
                {accountingAccess.budget && (
                  <Link href={`/project/${projectId}/accounting/budget`} onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${accountingPage === "budget" ? "text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                    <Wallet size={14} />
                    Presupuesto
                  </Link>
                )}
                {accountingAccess.users && (
                  <Link href={`/project/${projectId}/accounting/users`} onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${accountingPage === "users" ? "text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                    <Users size={14} />
                    Usuarios
                  </Link>
                )}
                {accountingAccess.reports && (
                  <Link href={`/project/${projectId}/accounting/reports`} onClick={() => setMenuOpen(false)} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${accountingPage === "reports" ? "text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}>
                    <BarChart3 size={14} />
                    Informes
                  </Link>
                )}
                <div className="border-t border-slate-100 my-1"></div>
                <button onClick={() => { setMenuOpen(false); handleLogout(); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 text-left">
                  <LogOut size={14} />
                  Cerrar sesión
                </button>
              </>
            ) : (
              <>
                <Link href={`/project/${projectId}/team`} onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-900 font-medium border-l-2 border-slate-900 bg-slate-50">
                  <Users size={14} />
                  Equipo
                </Link>
                <div className="border-t border-slate-100 my-1"></div>
                <button onClick={() => { setMenuOpen(false); handleLogout(); }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 text-left">
                  <LogOut size={14} />
                  Cerrar sesión
                </button>
              </>
            )}
          </nav>
        </div>
      )}

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.1s ease-out; }
      `}</style>
    </header>
  );
}
