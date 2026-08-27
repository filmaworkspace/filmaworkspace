"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  addDoc,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock,
  Crown,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  Info,
  LayoutDashboard,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Square,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  X,
  HeadphonesIcon,
  CheckCheck,
  Circle,
  Loader2,
  Wrench,
  Calculator,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { AutomatedMessages, DEFAULT_AUTOMATED_MESSAGES, fetchAutomatedMessages } from "@/lib/automatedMessages";
import { FeatureFlags, fetchFeatureFlags } from "@/lib/featureFlags";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const PHASES = ["Desarrollo", "Preproducción", "Rodaje", "Postproducción", "Finalizado"];

const phaseConfig: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  Desarrollo: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", dot: "bg-sky-500" },
  Preproducción: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
  Rodaje: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", dot: "bg-rose-500" },
  Postproducción: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500" },
  Finalizado: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
};

const DEFAULT_DEPARTMENTS = [
  { name: "Producción", color: "#3B82F6" },
  { name: "Dirección", color: "#8B5CF6" },
  { name: "Fotografía", color: "#F59E0B" },
  { name: "Arte", color: "#10B981" },
  { name: "Sonido", color: "#EC4899" },
  { name: "Vestuario", color: "#6366F1" },
  { name: "Maquillaje", color: "#14B8A6" },
  { name: "Localizaciones", color: "#F97316" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  phase: string;
  description?: string;
  producers?: string[];
  producerNames?: string[];
  createdAt: Timestamp;
  memberCount: number;
  members?: Member[];
  stats?: { poCount: number; invoiceCount: number; budgetTotal: number };
  /** Fecha del último evento en `logs` de este proyecto (ver "Cuentas en riesgo"): null si nunca hubo actividad registrada. */
  lastActivityAt?: Timestamp | null;
}

interface PendingInvitation {
  id: string;
  email: string;
  projectId: string;
  projectName: string;
  createdAt: Timestamp | null;
}

interface Member {
  odId: string;
  name: string;
  email: string;
  role?: string;
  position?: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  supportSpecialty?: "sales" | "technical" | "both";
  isDemo?: boolean;
  budgetingAccess?: boolean;
  createdAt?: Timestamp | null;
  projectCount: number;
  projects: UserProject[];
}

interface UserProject {
  id: string;
  name: string;
  role?: string;
  position?: string;
}

interface Producer {
  id: string;
  name: string;
  createdAt: Timestamp;
  projectCount: number;
  users?: { id: string; name: string; email: string }[];
}

interface SupportChat {
  id:             string;
  userId:         string;
  userName:       string;
  userEmail:      string;
  status:         "open" | "resolved";
  lastMessage:    string;
  lastMessageAt:  Timestamp | null;
  unreadAdmin:    number;
  contactType?:    "person" | "company";
  interestedInFW?: boolean | null;
  currentPage?:    string;
  ticketNumber?:   number;
  department?:     "sales" | "technical" | null;
  assignedTo?:     string | null;
  assignedToName?: string | null;
  assignedAt?:     Timestamp | null;
  resolvedAt?:     Timestamp | null;
}

const SPECIALTY_LABEL: Record<string, string> = {
  sales: "Ventas",
  technical: "Soporte técnico",
  both: "Ventas + Soporte",
};

const AUDIT_ACTION_LABEL: Record<string, string> = {
  maintenance_enabled: "activó el modo mantenimiento",
  maintenance_disabled: "desactivó el modo mantenimiento",
  project_deleted: "eliminó un proyecto",
  producer_deleted: "eliminó una productora",
  user_role_changed: "cambió el rol de un usuario",
  user_deleted: "eliminó un usuario",
  budgeting_access_granted: "concedió acceso a Budgeting",
  budgeting_access_revoked: "retiró el acceso a Budgeting",
  broadcast_sent: "mandó un mensaje masivo",
  feature_flag_created: "creó un flag de función",
  feature_flag_enabled_globally: "activó un flag para todos",
  feature_flag_disabled_globally: "desactivó un flag para todos",
  feature_flag_deleted: "eliminó un flag",
};

interface SupportMessage {
  id:         string;
  text:       string;
  sender:     "user" | "admin";
  senderName: string;
  createdAt:  Timestamp | null;
  system?:    boolean;
  guide?:     { title: string; url: string };
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

const STAT_ACCENTS: Record<string, string> = {
  blue: "text-blue-600 bg-blue-50",
  violet: "text-violet-600 bg-violet-50",
  amber: "text-amber-600 bg-amber-50",
  emerald: "text-emerald-600 bg-emerald-50",
  red: "text-red-600 bg-red-50",
  slate: "text-slate-500 bg-slate-100",
};

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent = "slate",
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  accent?: keyof typeof STAT_ACCENTS;
}) {
  return (
    <div className="border border-slate-200 rounded-xl px-4 py-3 bg-white">
      <span className={`inline-flex w-7 h-7 rounded-lg items-center justify-center mb-2 ${STAT_ACCENTS[accent]}`}>
        <Icon size={14} />
      </span>
      <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums leading-none">{value}</p>
      <p className="text-[11px] text-slate-500 mt-1.5">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

const NAV_SECTIONS: { id: "projects" | "users" | "producers" | "support" | "system"; label: string; icon: React.ElementType }[] = [
  { id: "projects", label: "Proyectos", icon: Briefcase },
  { id: "users", label: "Usuarios", icon: Users },
  { id: "producers", label: "Productoras", icon: Building2 },
  { id: "support", label: "Soporte", icon: HeadphonesIcon },
  { id: "system", label: "Sistema", icon: Activity },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();
  const { user: contextUser, isLoading: userLoading, maintenance } = useUser();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"projects" | "users" | "producers" | "support" | "system">("projects");

  // Support
  const [supportChats,      setSupportChats]      = useState<SupportChat[]>([]);
  const [activeChatId,      setActiveChatId]      = useState<string | null>(null);
  const [chatMessages,      setChatMessages]       = useState<SupportMessage[]>([]);
  const [supportInput,      setSupportInput]       = useState("");
  const [supportSending,    setSupportSending]     = useState(false);
  const [totalUnreadSupport, setTotalUnreadSupport] = useState(0);
  const [agents, setAgents] = useState<{ id: string; name: string; email: string; role: string; supportSpecialty?: string }[]>([]);
  const [publishedGuides, setPublishedGuides] = useState<{ id: string; title: string; slug: string; category: string }[]>([]);
  const [showAutomatedMessagesModal, setShowAutomatedMessagesModal] = useState(false);
  const [automatedMessagesForm, setAutomatedMessagesForm] = useState<AutomatedMessages>(DEFAULT_AUTOMATED_MESSAGES);
  const [automatedMessages, setAutomatedMessages] = useState<AutomatedMessages>(DEFAULT_AUTOMATED_MESSAGES);
  const [automatedMessagesLoading, setAutomatedMessagesLoading] = useState(false);
  const [automatedMessagesSaving, setAutomatedMessagesSaving] = useState(false);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintenanceMinutes, setMaintenanceMinutes] = useState(10);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [supportQueueFilter, setSupportQueueFilter] = useState<"unassigned" | "mine" | "all" | "resolved">("unassigned");
  const [showTransferMenu, setShowTransferMenu] = useState<string | null>(null);
  const [showGuidePicker, setShowGuidePicker] = useState<string | null>(null);
  const [guidePickerSearch, setGuidePickerSearch] = useState("");
  const [showMacroPicker, setShowMacroPicker] = useState(false);
  const macroPickerRef = useRef<HTMLDivElement>(null);
  const flagUserPickerRef = useRef<HTMLDivElement>(null);
  const transferMenuRef = useRef<HTMLDivElement>(null);
  const guidePickerRef = useRef<HTMLDivElement>(null);
  const supportMsgsRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [showAtRisk, setShowAtRisk] = useState<"stale" | "invites" | "producers" | null>(null);

  // Pestaña "Sistema": monitor del cron de Horario + registro de auditoría
  // (que también sirve de historial de difusión, filtrando por acción) +
  // flags de función.
  const [systemSubTab, setSystemSubTab] = useState<"cron" | "audit" | "broadcast" | "flags">("cron");
  const [cronRuns, setCronRuns] = useState<{ id: string; runAt: Timestamp | null; date: string; checked: number; triggered: string[]; errors: string[] }[]>([]);
  const [auditLog, setAuditLog] = useState<{ id: string; action: string; details: string; adminName: string; createdAt: Timestamp | null }[]>([]);
  const [systemDataLoading, setSystemDataLoading] = useState(false);
  const [systemDataLoaded, setSystemDataLoaded] = useState(false);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({});
  const [newFlagForm, setNewFlagForm] = useState({ label: "", description: "" });
  const [flagUserPickerFor, setFlagUserPickerFor] = useState<string | null>(null);
  const [flagUserPickerSearch, setFlagUserPickerSearch] = useState("");

  const [projectSearch, setProjectSearch] = useState("");
  const [projectPhaseFilter, setProjectPhaseFilter] = useState("all");
  const [showPhaseDropdown, setShowPhaseDropdown] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [producerSearch, setProducerSearch] = useState("");
  const [producerModalSearch, setProducerModalSearch] = useState("");

  // Buscador único: busca a la vez en proyectos/usuarios/productoras desde
  // cualquier pestaña, en vez de tener que adivinar antes cuál de los tres
  // buscadores aislados usar.
  const [globalSearch, setGlobalSearch] = useState("");
  const [showGlobalSearchResults, setShowGlobalSearchResults] = useState(false);
  const globalSearchRef = useRef<HTMLDivElement>(null);

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateProducer, setShowCreateProducer] = useState(false);
  const [showEditProducer, setShowEditProducer] = useState<string | null>(null);
  const [showUserDetails, setShowUserDetails] = useState<string | null>(null);
  const [showEditProject, setShowEditProject] = useState<string | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [showAssignCompanyUser, setShowAssignCompanyUser] = useState<string | null>(null);
  const [companyUserSearch, setCompanyUserSearch] = useState("");
  const [showRoleMenuFor, setShowRoleMenuFor] = useState<string | null>(null);
  const roleMenuRef = useRef<HTMLDivElement>(null);
  const [showCreateAgentModal, setShowCreateAgentModal] = useState(false);
  const [agentForm, setAgentForm] = useState({ name: "", email: "", password: "", specialty: "both" as "sales" | "technical" | "both" });
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [agentCreated, setAgentCreated] = useState<{ email: string; password: string } | null>(null);

  const [newProject, setNewProject] = useState({ name: "", description: "", phase: "Desarrollo", producers: [] as string[], customId: "", useCustomId: false, language: "es" });
  const [newProducer, setNewProducer] = useState({ name: "" });

  // Demo user modal
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [demoForm, setDemoForm] = useState({ name: "", email: "", password: "" });
  const [demoCreated, setDemoCreated] = useState<{ email: string; password: string } | null>(null);
  const [demoSaving, setDemoSaving] = useState(false);
  const [demoError, setDemoError] = useState("");

  // Message modal states
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageForm, setMessageForm] = useState({
    content: "",
    recipientMode: "all" as "all" | "projects" | "users" | "segment",
    selectedProjects: [] as string[],
    selectedUsers: [] as string[],
    selectedSegment: null as string | null,
    duration: "indefinite" as "24h" | "7d" | "30d" | "indefinite",
    sendByEmail: false,
  });
  const [emailConfirmStep, setEmailConfirmStep] = useState(false);
  const [projectSearchInMessage, setProjectSearchInMessage] = useState("");
  const [userSearchInMessage, setUserSearchInMessage] = useState("");

  // Custom confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const showConfirmDialog = (title: string, message: string, onConfirm: () => void, options?: { confirmLabel?: string; danger?: boolean }) => {
    setConfirmDialog({ title, message, onConfirm, danger: options?.danger ?? true, confirmLabel: options?.confirmLabel });
  };

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);


  const menuRef = useRef<HTMLDivElement>(null);
  const phaseDropdownRef = useRef<HTMLDivElement>(null);
  const roleDropdownRef = useRef<HTMLDivElement>(null);

  const isAdmin = contextUser?.role === "admin";
  const isSupportAgent = contextUser?.role === "support_agent";
  const hasAdminAccess = isAdmin || isSupportAgent;

  useEffect(() => {
    if (!userLoading && !hasAdminAccess) {
      router.push("/dashboard");
    }
  }, [contextUser, userLoading, router, hasAdminAccess]);

  // Los agentes de soporte no cargan proyectos/usuarios/productoras/mensajes:
  // solo trabajan sobre la pestaña de soporte.
  useEffect(() => {
    if (isSupportAgent) {
      setActiveTab("support");
      setLoading(false);
    }
  }, [isSupportAgent]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
      if (phaseDropdownRef.current && !phaseDropdownRef.current.contains(e.target as Node)) {
        setShowPhaseDropdown(false);
      }
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target as Node)) {
        setShowRoleDropdown(false);
      }
      if (transferMenuRef.current && !transferMenuRef.current.contains(e.target as Node)) {
        setShowTransferMenu(null);
      }
      if (guidePickerRef.current && !guidePickerRef.current.contains(e.target as Node)) {
        setShowGuidePicker(null);
        setGuidePickerSearch("");
      }
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target as Node)) {
        setShowRoleMenuFor(null);
      }
      if (globalSearchRef.current && !globalSearchRef.current.contains(e.target as Node)) {
        setShowGlobalSearchResults(false);
      }
      if (macroPickerRef.current && !macroPickerRef.current.contains(e.target as Node)) {
        setShowMacroPicker(false);
      }
      if (flagUserPickerRef.current && !flagUserPickerRef.current.contains(e.target as Node)) {
        setFlagUserPickerFor(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // Registro de auditoría: quién hizo qué cambio sensible y cuándo, en vez de
  // que solo quede constancia (si acaso) en el `logs` del proyecto afectado.
  // Fire-and-forget a propósito — un fallo al escribir el registro no debe
  // bloquear la acción real que el admin ya pidió.
  const logAdminAction = (action: string, details: string) => {
    addDoc(collection(db, "adminAuditLog"), {
      action,
      details,
      adminId: contextUser?.uid || "",
      adminName: contextUser?.name || contextUser?.email || "Admin",
      createdAt: serverTimestamp(),
    }).catch((err) => console.error("[adminAuditLog]", err));
  };

  const loadData = async () => {
    if (!contextUser?.uid) return;
    try {
      const producersSnap = await getDocs(collection(db, "producers"));
      const producersData: Producer[] = producersSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().name,
        createdAt: d.data().createdAt,
        projectCount: 0,
      }));

      const projectsSnap = await getDocs(collection(db, "projects"));
      const projectsData: Project[] = await Promise.all(
        projectsSnap.docs.map(async (projectDoc) => {
          const data = projectDoc.data();
          const producerIds = data.producers || [];
          const producerNames = producerIds.map((pid: string) => producersData.find((p) => p.id === pid)?.name || "Eliminada");
          const membersSnap = await getDocs(collection(db, `projects/${projectDoc.id}/members`));
          const members: Member[] = membersSnap.docs.map((m) => ({
            odId: m.id,
            name: m.data().name,
            email: m.data().email,
            role: m.data().role,
            position: m.data().position,
          }));
          // Solo el último evento de logs: para "Cuentas en riesgo" (ver más abajo)
          // no hace falta el historial entero, solo saber si sigue vivo.
          const lastLogSnap = await getDocs(
            query(collection(db, `projects/${projectDoc.id}/logs`), orderBy("createdAt", "desc"), limit(1))
          );
          return {
            id: projectDoc.id,
            name: data.name,
            phase: data.phase,
            description: data.description || "",
            producers: producerIds,
            producerNames,
            createdAt: data.createdAt,
            memberCount: membersSnap.size,
            members,
            lastActivityAt: lastLogSnap.empty ? null : (lastLogSnap.docs[0].data().createdAt as Timestamp),
          };
        })
      );

      producersData.forEach((p) => {
        p.projectCount = projectsData.filter((pr) => pr.producers?.includes(p.id)).length;
      });
      setProjects(projectsData);

      // Invitaciones pendientes de todos los proyectos, para "Cuentas en riesgo":
      // una invitación mandada y nunca aceptada es una señal de que alguien se
      // quedó fuera sin que nadie se diera cuenta.
      const pendingInvitesSnap = await getDocs(query(collection(db, "invitations"), where("status", "==", "pending")));
      setPendingInvitations(
        pendingInvitesSnap.docs.map((d) => {
          const invData = d.data();
          return {
            id: d.id,
            email: invData.email || invData.invitedEmail || "",
            projectId: invData.projectId || "",
            projectName: projectsData.find((p) => p.id === invData.projectId)?.name || "Proyecto eliminado",
            createdAt: invData.createdAt || null,
          };
        })
      );

      const usersSnap = await getDocs(collection(db, "users"));
      const usersData: User[] = await Promise.all(
        usersSnap.docs.map(async (userDoc) => {
          const data = userDoc.data();
          const userProjectsSnap = await getDocs(collection(db, `userProjects/${userDoc.id}/projects`));
          const userProjects: UserProject[] = await Promise.all(
            userProjectsSnap.docs.map(async (upDoc) => {
              const upData = upDoc.data();
              const projectDoc = await getDoc(doc(db, "projects", upDoc.id));
              return {
                id: upDoc.id,
                name: projectDoc.exists() ? projectDoc.data().name : "Eliminado",
                role: upData.role,
                position: upData.position,
              };
            })
          );
          return {
            id: userDoc.id,
            name: data.name || data.email,
            email: data.email,
            phone: data.phone || "",
            role: data.role || "user",
            supportSpecialty: data.supportSpecialty || undefined,
            isDemo: data.isDemo || false,
            budgetingAccess: data.budgetingAccess || false,
            createdAt: data.createdAt || null,
            projectCount: userProjectsSnap.size,
            projects: userProjects,
          };
        })
      );
      setUsers(usersData);

      // Assign users to producers based on companyId
      producersData.forEach((p) => {
        p.users = usersData
          .filter((u) => {
            const userData = usersSnap.docs.find((d) => d.id === u.id)?.data();
            return userData?.companyId === p.id;
          })
          .map((u) => ({ id: u.id, name: u.name, email: u.email }));
      });
      setProducers(producersData);

      setLoading(false);
      setRefreshing(false);
    } catch (error) {
      console.error(error);
      showToast("error", "Error al cargar los datos");
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (contextUser?.uid && isAdmin) loadData();
  }, [contextUser?.uid, isAdmin]);

  // Cargadas aparte del modal de "Mensajes automáticos" (que solo pide los
  // datos al abrirse): así las respuestas rápidas están disponibles en la
  // cola de soporte desde el primer momento, sin tener que abrir ese modal antes.
  useEffect(() => {
    if (!contextUser?.uid) return;
    fetchAutomatedMessages(db).then(setAutomatedMessages);
  }, [contextUser?.uid]);

  // Datos de la pestaña "Sistema": se cargan solo la primera vez que se
  // entra ahí, no en el arranque general (nadie los necesita en cada visita).
  useEffect(() => {
    if (activeTab !== "system" || systemDataLoaded || !isAdmin) return;
    setSystemDataLoading(true);
    (async () => {
      try {
        const [cronSnap, auditSnap, flags] = await Promise.all([
          getDocs(query(collection(db, "meta/horarioCron/runs"), orderBy("runAt", "desc"), limit(20))),
          getDocs(query(collection(db, "adminAuditLog"), orderBy("createdAt", "desc"), limit(60))),
          fetchFeatureFlags(db),
        ]);
        setCronRuns(cronSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setAuditLog(auditSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
        setFeatureFlags(flags);
        setSystemDataLoaded(true);
      } catch (err) {
        console.error(err);
      } finally {
        setSystemDataLoading(false);
      }
    })();
  }, [activeTab, systemDataLoaded, isAdmin]);

  // Real-time support chats listener
  useEffect(() => {
    if (!hasAdminAccess) return;
    const unsub = onSnapshot(collection(db, "supportChats"), (snap) => {
      const chats = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SupportChat));
      chats.sort((a, b) => (b.lastMessageAt?.seconds ?? 0) - (a.lastMessageAt?.seconds ?? 0));
      setSupportChats(chats);
      setTotalUnreadSupport(chats.reduce((sum, c) => sum + (c.unreadAdmin > 0 ? 1 : 0), 0));
    });
    return () => unsub();
  }, [hasAdminAccess]);

  // Live roster of agents (full admins + support agents) who can own/receive tickets
  useEffect(() => {
    if (!hasAdminAccess) return;
    const q = query(collection(db, "users"), where("role", "in", ["admin", "support_agent"]));
    const unsub = onSnapshot(q, (snap) => {
      setAgents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
    });
    return () => unsub();
  }, [hasAdminAccess]);

  // Guías publicadas, para poder enviarlas por link desde un ticket de soporte
  useEffect(() => {
    if (!hasAdminAccess) return;
    const q = query(collection(db, "guides"), where("published", "==", true));
    const unsub = onSnapshot(q, (snap) => {
      setPublishedGuides(snap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
    });
    return () => unsub();
  }, [hasAdminAccess]);


  // Load messages when active chat changes
  useEffect(() => {
    if (!activeChatId) { setChatMessages([]); return; }
    const q = query(
      collection(db, `supportChats/${activeChatId}/messages`),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setChatMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SupportMessage)));
      setTimeout(() => supportMsgsRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    });
    // Mark as read
    updateDoc(doc(db, "supportChats", activeChatId), { unreadAdmin: 0 }).catch(() => {});
    return () => unsub();
  }, [activeChatId]);

  const handleSupportReply = async () => {
    const text = supportInput.trim();
    if (!text || !activeChatId || supportSending) return;
    setSupportSending(true);
    setSupportInput("");
    try {
      await addDoc(collection(db, `supportChats/${activeChatId}/messages`), {
        text, sender: "admin", senderName: "Soporte Filma", createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "supportChats", activeChatId), {
        lastMessage: text, lastMessageAt: serverTimestamp(), unreadUser: 1,
      });
    } finally {
      setSupportSending(false);
    }
  };

  const handleResolveChat = async (chatId: string) => {
    await updateDoc(doc(db, "supportChats", chatId), { status: "resolved", unreadAdmin: 0, resolvedAt: serverTimestamp() });
    if (activeChatId === chatId) setActiveChatId(null);
  };

  const handleReopenChat = async (chatId: string) => {
    await updateDoc(doc(db, "supportChats", chatId), { status: "open" });
  };

  // Reclama un ticket sin asignar. La transacción evita que dos agentes se lo
  // queden a la vez si hacen clic casi simultáneamente.
  const handleClaimChat = async (chatId: string) => {
    if (!contextUser?.uid) return;
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "supportChats", chatId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Ticket no encontrado");
        if (snap.data().assignedTo) throw new Error("Este ticket ya ha sido asignado a otro agente");
        tx.update(ref, {
          assignedTo: contextUser.uid,
          assignedToName: contextUser.name || contextUser.email || "Agente",
          assignedAt: serverTimestamp(),
        });
      });
      await addDoc(collection(db, `supportChats/${chatId}/messages`), {
        text: `Ticket asignado a ${contextUser.name || contextUser.email}`,
        sender: "admin",
        senderName: "Sistema",
        system: true,
        createdAt: serverTimestamp(),
      });
      setActiveChatId(chatId);
      setSupportQueueFilter("mine");
      showToast("success", "Ticket asignado a ti");
    } catch (error: any) {
      showToast("error", error.message || "No se pudo asignar el ticket");
    }
  };

  // Pasa el ticket a otro agente: "le salta" — deja de estar en tu bandeja y
  // aparece en la del agente elegido.
  const handleTransferChat = async (chatId: string, toAgentId: string) => {
    const toAgent = agents.find((a) => a.id === toAgentId);
    if (!toAgent) return;
    try {
      await updateDoc(doc(db, "supportChats", chatId), {
        assignedTo: toAgent.id,
        assignedToName: toAgent.name,
        assignedAt: serverTimestamp(),
      });
      await addDoc(collection(db, `supportChats/${chatId}/messages`), {
        text: `Transferido a ${toAgent.name} por ${contextUser?.name || contextUser?.email || "un agente"}`,
        sender: "admin",
        senderName: "Sistema",
        system: true,
        createdAt: serverTimestamp(),
      });
      setShowTransferMenu(null);
      showToast("success", `Transferido a ${toAgent.name}`);
    } catch (error) {
      console.error(error);
      showToast("error", "No se pudo transferir el ticket");
    }
  };

  // Envía el link de una guía publicada como mensaje del agente en el ticket
  const handleInsertGuide = async (chatId: string, guide: { title: string; slug: string }) => {
    try {
      const url = `${window.location.origin}/guias/${guide.slug}`;
      await addDoc(collection(db, `supportChats/${chatId}/messages`), {
        text: guide.title,
        guide: { title: guide.title, url },
        sender: "admin",
        senderName: contextUser?.name || contextUser?.email || "Soporte Filma",
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "supportChats", chatId), {
        lastMessage: `📘 ${guide.title}`,
        lastMessageAt: serverTimestamp(),
        unreadUser: 1,
      });
      setShowGuidePicker(null);
      setGuidePickerSearch("");
      showToast("success", "Guía enviada");
    } catch (error) {
      console.error(error);
      showToast("error", "No se pudo enviar la guía");
    }
  };

  const openAutomatedMessagesModal = async () => {
    setShowAutomatedMessagesModal(true);
    setAutomatedMessagesLoading(true);
    const templates = await fetchAutomatedMessages(db);
    setAutomatedMessagesForm(templates);
    setAutomatedMessagesLoading(false);
  };

  const handleSaveAutomatedMessages = async () => {
    setAutomatedMessagesSaving(true);
    try {
      await setDoc(doc(db, "meta", "automatedMessages"), {
        ...automatedMessagesForm,
        updatedAt: serverTimestamp(),
        updatedBy: contextUser?.name || contextUser?.email || "Admin",
      });
      setAutomatedMessages(automatedMessagesForm);
      showToast("success", "Mensajes automáticos actualizados");
      setShowAutomatedMessagesModal(false);
    } catch (error) {
      console.error(error);
      showToast("error", "No se pudo guardar");
    } finally {
      setAutomatedMessagesSaving(false);
    }
  };

  const handleActivateMaintenance = async () => {
    setMaintenanceSaving(true);
    try {
      await setDoc(doc(db, "meta", "maintenance"), {
        enabled: true,
        startAt: Timestamp.fromMillis(Date.now() + maintenanceMinutes * 60000),
        message: maintenanceMessage.trim(),
        activatedAt: serverTimestamp(),
        activatedBy: contextUser?.uid || "",
        activatedByName: contextUser?.name || contextUser?.email || "Admin",
      });
      logAdminAction("maintenance_enabled", maintenanceMinutes === 0 ? "Activado de inmediato" : `Programado en ${maintenanceMinutes} min — "${maintenanceMessage.trim()}"`);
      showToast("success", maintenanceMinutes === 0 ? "Mantenimiento activado" : `Mantenimiento programado en ${maintenanceMinutes} min`);
      setShowMaintenanceModal(false);
    } catch (error) {
      console.error(error);
      showToast("error", "No se pudo activar el mantenimiento");
    } finally {
      setMaintenanceSaving(false);
    }
  };

  const handleDeactivateMaintenance = async () => {
    setMaintenanceSaving(true);
    try {
      await setDoc(doc(db, "meta", "maintenance"), {
        enabled: false,
        deactivatedAt: serverTimestamp(),
        deactivatedBy: contextUser?.uid || "",
      }, { merge: true });
      logAdminAction("maintenance_disabled", "");
      showToast("success", "Mantenimiento desactivado");
      setShowMaintenanceModal(false);
    } catch (error) {
      console.error(error);
      showToast("error", "No se pudo desactivar el mantenimiento");
    } finally {
      setMaintenanceSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (!isAdmin) {
      showToast("success", "Los tickets se actualizan en tiempo real");
      return;
    }
    setRefreshing(true);
    await loadData();
    showToast("success", "Datos actualizados");
  };

  // Generar ID corto de 6 caracteres
  const generateShortId = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleCreateProject = async () => {
    if (!newProject.name.trim()) {
      showToast("error", "El nombre es obligatorio");
      return;
    }
    if (newProject.useCustomId) {
      const raw = newProject.customId.trim();
      if (!raw) { showToast("error", "Introduce un ID para el proyecto"); return; }
      if (!/^[a-zA-Z0-9_-]+$/.test(raw)) { showToast("error", "El ID solo puede contener letras, números, guiones y guiones bajos"); return; }
      const existing = await getDoc(doc(db, "projects", raw));
      if (existing.exists()) { showToast("error", `Ya existe un proyecto con el ID "${raw}"`); return; }
    }
    setSaving(true);
    try {
      const projectId = newProject.useCustomId ? newProject.customId.trim() : generateShortId();
      const projectRef = doc(db, "projects", projectId);
      
      // Crear proyecto con departamentos como array (igual que el resto de la app)
      await setDoc(projectRef, {
        name: newProject.name.trim(),
        description: newProject.description.trim(),
        phase: newProject.phase,
        producers: newProject.producers,
        departments: DEFAULT_DEPARTMENTS.map(d => d.name),
        language: newProject.language,
        createdAt: serverTimestamp(),
      });

      // Sincronizar companyProjects para cada productora asignada
      for (const producerId of newProject.producers) {
        await setDoc(doc(db, `companyProjects/${producerId}/projects`, projectId), {
          projectId,
          name: newProject.name.trim(),
          phase: newProject.phase,
          addedAt: serverTimestamp(),
        });
      }
      
      setNewProject({ name: "", description: "", phase: "Desarrollo", producers: [], customId: "", useCustomId: false, language: "es" });
      setShowCreateProject(false);
      showToast("success", "Proyecto creado correctamente");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al crear el proyecto");
    } finally {
      setSaving(false);
    }
  };

  const handleEditProject = async () => {
    if (!showEditProject) return;
    setSaving(true);
    try {
      const oldProject = projects.find(p => p.id === showEditProject);
      const oldProducers = oldProject?.producers || [];
      const newProducers = newProject.producers;

      await updateDoc(doc(db, "projects", showEditProject), {
        name: newProject.name.trim(),
        description: newProject.description.trim(),
        phase: newProject.phase,
        producers: newProject.producers,
        language: newProject.language,
      });

      // Sincronizar companyProjects
      // Eliminar de productoras que ya no están asignadas
      for (const producerId of oldProducers) {
        if (!newProducers.includes(producerId)) {
          await deleteDoc(doc(db, `companyProjects/${producerId}/projects`, showEditProject));
        }
      }
      
      // Añadir/actualizar en productoras asignadas
      for (const producerId of newProducers) {
        await setDoc(doc(db, `companyProjects/${producerId}/projects`, showEditProject), {
          projectId: showEditProject,
          name: newProject.name.trim(),
          phase: newProject.phase,
          addedAt: serverTimestamp(),
        });
      }

      setShowEditProject(null);
      showToast("success", "Proyecto actualizado");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    showConfirmDialog(`Eliminar "${project.name}"`, "Esta acción eliminará el proyecto y todos sus miembros. No se puede deshacer.", () => _doDeleteProject(projectId));
  };
  const _doDeleteProject = async (projectId: string) => {
    setSaving(true);
    try {
      const projectName = projects.find((p) => p.id === projectId)?.name || projectId;
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/delete-project", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ projectId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Error al eliminar");
      logAdminAction("project_deleted", projectName);
      showToast("success", "Proyecto eliminado completamente");
      setActiveMenu(null);
      setConfirmDialog(null);
      await loadData();
    } catch (error: any) {
      console.error(error);
      showToast("error", error.message || "Error al eliminar");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateProducer = async () => {
    if (!newProducer.name.trim()) {
      showToast("error", "El nombre es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const producerRef = doc(collection(db, "producers"));
      await setDoc(producerRef, { name: newProducer.name.trim(), createdAt: serverTimestamp() });
      setNewProducer({ name: "" });
      setShowCreateProducer(false);
      showToast("success", "Productora creada");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al crear");
    } finally {
      setSaving(false);
    }
  };

  const handleEditProducer = async () => {
    if (!showEditProducer) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "producers", showEditProducer), { name: newProducer.name.trim() });
      setShowEditProducer(null);
      setNewProducer({ name: "" });
      showToast("success", "Productora actualizada");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProducer = async (producerId: string) => {
    const producer = producers.find((p) => p.id === producerId);
    if (!producer) return;
    if (producer.projectCount > 0) {
      showToast("error", `"${producer.name}" tiene proyectos asignados`);
      return;
    }
    showConfirmDialog(`Eliminar "${producer.name}"`, "Se eliminará la productora permanentemente.", () => _doDeleteProducer(producerId));
  };
  const _doDeleteProducer = async (producerId: string) => {
    const producer = producers.find((p) => p.id === producerId);
    if (!producer) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "producers", producerId));
      logAdminAction("producer_deleted", producer.name);
      showToast("success", "Productora eliminada");
      setConfirmDialog(null);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveUserFromProject = async (projectId: string, odId: string) => {
    showConfirmDialog("Eliminar usuario del proyecto", "El usuario perderá acceso a este proyecto.", () => _doRemoveUserFromProject(projectId, odId));
  };
  const _doRemoveUserFromProject = async (projectId: string, odId: string) => {
    setSaving(true);
    try {
      await deleteDoc(doc(db, `projects/${projectId}/members`, odId));
      await deleteDoc(doc(db, `userProjects/${odId}/projects/${projectId}`));
      showToast("success", "Usuario eliminado del proyecto");
      setConfirmDialog(null);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar");
    } finally {
      setSaving(false);
    }
  };

  const handleChangeUserRole = (
    odId: string,
    newRole: "admin" | "user" | "support_agent",
    specialty?: "sales" | "technical" | "both"
  ) => {
    const user = users.find((u) => u.id === odId);
    const doChange = () => _doChangeUserRole(odId, newRole, specialty);
    if (newRole === "admin") {
      showConfirmDialog(
        "Hacer administrador",
        `${user?.name} tendrá acceso completo al panel de administración.`,
        doChange,
        { danger: false, confirmLabel: "Hacer admin" }
      );
    } else if (newRole === "support_agent") {
      showConfirmDialog(
        "Convertir en agente de soporte",
        `${user?.name} solo tendrá acceso a la pestaña de Soporte, con especialidad "${SPECIALTY_LABEL[specialty || "both"]}".`,
        doChange,
        { danger: false, confirmLabel: "Convertir en agente" }
      );
    } else {
      doChange();
    }
  };
  const _doChangeUserRole = async (odId: string, newRole: string, specialty?: string) => {
    setSaving(true);
    try {
      const target = users.find((u) => u.id === odId);
      await updateDoc(doc(db, "users", odId), {
        role: newRole,
        supportSpecialty: newRole === "support_agent" ? specialty || "both" : null,
      });
      logAdminAction("user_role_changed", `${target?.name || odId}: ${target?.role || "user"} → ${newRole}${specialty ? ` (${SPECIALTY_LABEL[specialty]})` : ""}`);
      showToast("success", "Rol actualizado");
      setConfirmDialog(null);
      setShowRoleMenuFor(null);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar el rol");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSupportAgent = async () => {
    if (!agentForm.name.trim()) { setAgentError("El nombre es obligatorio"); return; }
    setAgentSaving(true);
    setAgentError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/create-support-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          name: agentForm.name.trim(),
          email: agentForm.email,
          password: agentForm.password,
          specialty: agentForm.specialty,
        }),
      });
      const body = await res.json();
      if (!res.ok) { setAgentError(body.error || "Error al crear el agente"); return; }
      setAgentCreated({ email: agentForm.email, password: agentForm.password });
      await loadData();
    } catch {
      setAgentError("Error de red");
    } finally {
      setAgentSaving(false);
    }
  };

  const openCreateAgentModal = () => {
    const rand = Math.random().toString(36).slice(2, 7);
    const pw = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 5).toUpperCase() + "!1";
    setAgentForm({ name: "", email: `agente.${rand}@filmaworkspace.com`, password: pw, specialty: "both" });
    setAgentCreated(null);
    setAgentError("");
    setShowCreateAgentModal(true);
  };

  const handleDeleteUser = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    showConfirmDialog(
      `Eliminar "${user.name}"`,
      `Se eliminará el usuario de Firebase Auth y Firestore. Sus proyectos quedarán intactos pero sin este miembro. Esta acción no se puede deshacer.`,
      () => _doDeleteUser(userId),
      { danger: true, confirmLabel: "Eliminar usuario" }
    );
  };
  const _doDeleteUser = async (userId: string) => {
    setSaving(true);
    try {
      const target = users.find((u) => u.id === userId);
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ uid: userId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Error al eliminar");
      logAdminAction("user_deleted", `${target?.name || userId} (${target?.email || ""})`);
      showToast("success", "Usuario eliminado completamente");
      setConfirmDialog(null);
      setShowUserDetails(null);
      await loadData();
    } catch (error: any) {
      console.error(error);
      showToast("error", error.message || "Error al eliminar");
    } finally {
      setSaving(false);
    }
  };

  const handleAssignCompanyUser = async (odId: string, producerId: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", odId), { companyId: producerId });
      setShowAssignCompanyUser(null);
      setCompanyUserSearch("");
      showToast("success", "Usuario asignado a productora");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al asignar usuario");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCompanyUser = async (odId: string) => {
    const user = users.find(u => u.id === odId);
    showConfirmDialog("Quitar de productora", `${user?.name} dejará de tener acceso al panel de la productora.`, () => _doRemoveCompanyUser(odId));
  };
  const _doRemoveCompanyUser = async (odId: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", odId), { companyId: null });
      showToast("success", "Usuario eliminado de productora");
      setConfirmDialog(null);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar usuario");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleBudgetingAccess = async (odId: string, next: boolean) => {
    setSaving(true);
    try {
      const target = users.find((u) => u.id === odId);
      await updateDoc(doc(db, "users", odId), { budgetingAccess: next });
      setUsers((prev) => prev.map((u) => u.id === odId ? { ...u, budgetingAccess: next } : u));
      logAdminAction(next ? "budgeting_access_granted" : "budgeting_access_revoked", target?.name || odId);
      showToast("success", next ? "Acceso a Budgeting concedido" : "Acceso a Budgeting retirado");
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar el acceso a Budgeting");
    } finally {
      setSaving(false);
    }
  };

  // ── Flags de función: crear, activar globalmente, activar para un usuario
  // concreto, o borrar. Se guardan todos en un único doc (meta/featureFlags). ─
  const saveFeatureFlags = async (next: FeatureFlags) => {
    await setDoc(doc(db, "meta", "featureFlags"), next);
    setFeatureFlags(next);
  };
  const handleCreateFlag = async () => {
    if (!newFlagForm.label.trim()) { showToast("error", "Ponle un nombre al flag"); return; }
    const id = newFlagForm.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `flag_${Date.now()}`;
    if (featureFlags[id]) { showToast("error", "Ya existe un flag con ese nombre"); return; }
    setSaving(true);
    try {
      await saveFeatureFlags({
        ...featureFlags,
        [id]: { id, label: newFlagForm.label.trim(), description: newFlagForm.description.trim(), enabledGlobally: false, enabledUserIds: [] },
      });
      logAdminAction("feature_flag_created", newFlagForm.label.trim());
      setNewFlagForm({ label: "", description: "" });
      showToast("success", "Flag creado");
    } catch (error) {
      console.error(error);
      showToast("error", "Error al crear el flag");
    } finally {
      setSaving(false);
    }
  };
  const handleToggleFlagGlobal = async (flagId: string, next: boolean) => {
    const flag = featureFlags[flagId];
    if (!flag) return;
    setSaving(true);
    try {
      await saveFeatureFlags({ ...featureFlags, [flagId]: { ...flag, enabledGlobally: next } });
      logAdminAction(next ? "feature_flag_enabled_globally" : "feature_flag_disabled_globally", flag.label);
      showToast("success", next ? `"${flag.label}" activado para todos` : `"${flag.label}" desactivado para todos`);
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar el flag");
    } finally {
      setSaving(false);
    }
  };
  const handleToggleFlagUser = async (flagId: string, userId: string) => {
    const flag = featureFlags[flagId];
    if (!flag) return;
    const has = flag.enabledUserIds.includes(userId);
    const enabledUserIds = has ? flag.enabledUserIds.filter((id) => id !== userId) : [...flag.enabledUserIds, userId];
    try {
      await saveFeatureFlags({ ...featureFlags, [flagId]: { ...flag, enabledUserIds } });
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar el flag");
    }
  };
  const handleDeleteFlag = async (flagId: string) => {
    const flag = featureFlags[flagId];
    if (!flag) return;
    setSaving(true);
    try {
      const { [flagId]: _, ...rest } = featureFlags;
      await saveFeatureFlags(rest);
      logAdminAction("feature_flag_deleted", flag.label);
      showToast("success", "Flag eliminado");
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar el flag");
    } finally {
      setSaving(false);
    }
  };

  // Send message to users
  const handleSendMessage = async () => {
    if (!messageForm.content.trim()) {
      showToast("error", "Escribe un mensaje");
      return;
    }
    if (messageForm.recipientMode === "projects" && messageForm.selectedProjects.length === 0) {
      showToast("error", "Selecciona al menos un proyecto");
      return;
    }
    if (messageForm.recipientMode === "users" && messageForm.selectedUsers.length === 0) {
      showToast("error", "Selecciona al menos un usuario");
      return;
    }
    if (messageForm.recipientMode === "segment" && !messageForm.selectedSegment) {
      showToast("error", "Selecciona un segmento");
      return;
    }

    setSaving(true);
    try {
      // Determine which users to send to
      let targetUserIds: string[] = [];

      if (messageForm.recipientMode === "all") {
        targetUserIds = users.map((u) => u.id);
      } else if (messageForm.recipientMode === "projects") {
        const selectedProjectsData = projects.filter((p) => messageForm.selectedProjects.includes(p.id));
        const userIdSet = new Set<string>();
        selectedProjectsData.forEach((project) => {
          project.members?.forEach((member) => { userIdSet.add(member.odId); });
        });
        targetUserIds = Array.from(userIdSet);
      } else if (messageForm.recipientMode === "segment") {
        targetUserIds = SEGMENT_PRESETS.find((s) => s.id === messageForm.selectedSegment)?.userIds || [];
      } else {
        targetUserIds = messageForm.selectedUsers;
      }

      // Calculate expiration
      let expiresAt: Date | null = null;
      if (messageForm.duration !== "indefinite") {
        expiresAt = new Date();
        if (messageForm.duration === "24h") expiresAt.setHours(expiresAt.getHours() + 24);
        else if (messageForm.duration === "7d") expiresAt.setDate(expiresAt.getDate() + 7);
        else if (messageForm.duration === "30d") expiresAt.setDate(expiresAt.getDate() + 30);
      }

      // Create a message for each user
      const messageData = {
        content: messageForm.content.trim(),
        type: "info",
        sentAt: serverTimestamp(),
        sentBy: contextUser?.uid,
        sentByName: contextUser?.name || contextUser?.email || "Admin",
        read: false,
        targetProjects: messageForm.recipientMode === "projects" ? messageForm.selectedProjects : null,
        expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
      };

      // Save message to each user's messages subcollection
      for (const odId of targetUserIds) {
        const messageRef = doc(collection(db, `users/${odId}/messages`));
        await setDoc(messageRef, messageData);
      }

      // Fire-and-forget email broadcast if requested
      if (messageForm.sendByEmail) {
        const emails = targetUserIds.map((id) => users.find((u) => u.id === id)?.email).filter(Boolean) as string[];
        const idToken = await auth.currentUser?.getIdToken();
        fetch("/api/send-broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ to: emails, content: messageForm.content.trim() }),
        }).catch(console.error);
      }

      // Deja rastro en el mismo registro de auditoría, para el historial de
      // difusión de la pestaña Sistema: quién mandó qué, a cuántos y cuándo.
      const recipientModeLabel =
        messageForm.recipientMode === "all" ? "todos" :
        messageForm.recipientMode === "projects" ? "por proyecto" :
        messageForm.recipientMode === "segment" ? `segmento "${SEGMENT_PRESETS.find((s) => s.id === messageForm.selectedSegment)?.label}"` :
        "usuarios concretos";
      logAdminAction(
        "broadcast_sent",
        `"${messageForm.content.trim().slice(0, 140)}" → ${targetUserIds.length} usuario${targetUserIds.length !== 1 ? "s" : ""} (${recipientModeLabel})${messageForm.sendByEmail ? " + email" : ""}`
      );

      // Reset form and close modal
      setEmailConfirmStep(false);
      setMessageForm({
        content: "",
        recipientMode: "all",
        selectedProjects: [],
        selectedUsers: [],
        selectedSegment: null,
        duration: "indefinite",
        sendByEmail: false,
      });
      setProjectSearchInMessage("");
      setUserSearchInMessage("");
      setShowMessageModal(false);
      showToast("success", `Mensaje enviado a ${targetUserIds.length} usuario${targetUserIds.length !== 1 ? "s" : ""}${messageForm.sendByEmail ? " (+ email)" : ""}`);
    } catch (error) {
      console.error(error);
      showToast("error", "Error al enviar el mensaje");
    } finally {
      setSaving(false);
    }
  };

  // Export users to CSV
  const handleExportUsersCSV = () => {
    const header = ["Nombre", "Email", "Teléfono", "Rol", "Nº proyectos", "Proyectos"];
    const rows = filteredUsers.map((u) => [
      u.name,
      u.email,
      u.phone || "",
      u.role === "admin" ? "Administrador" : "Usuario",
      String(u.projectCount),
      u.projects.map((p) => p.name).join(" | "),
    ]);
    const csvContent = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `usuarios_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("success", "CSV exportado");
  };

  const openDemoModal = () => {
    const rand = Math.random().toString(36).slice(2, 7);
    const pw = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 5).toUpperCase() + "!1";
    setDemoForm({ name: "", email: `demo.${rand}@filmaworkspace.demo`, password: pw });
    setDemoCreated(null);
    setDemoError("");
    setShowDemoModal(true);
  };

  const handleCreateDemoUser = async () => {
    if (!demoForm.name.trim()) { setDemoError("El nombre es obligatorio"); return; }
    setDemoSaving(true);
    setDemoError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/create-demo-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ name: demoForm.name.trim(), email: demoForm.email, password: demoForm.password }),
      });
      const body = await res.json();
      if (!res.ok) { setDemoError(body.error || "Error al crear el usuario"); return; }
      setDemoCreated({ email: demoForm.email, password: demoForm.password });
      await loadData();
    } catch {
      setDemoError("Error de red");
    } finally {
      setDemoSaving(false);
    }
  };

  const toggleProjectInMessage = (projectId: string) => {
    setMessageForm((prev) => ({
      ...prev,
      selectedProjects: prev.selectedProjects.includes(projectId)
        ? prev.selectedProjects.filter((id) => id !== projectId)
        : [...prev.selectedProjects, projectId],
    }));
  };

  const toggleUserInMessage = (userId: string) => {
    setMessageForm((prev) => ({
      ...prev,
      selectedUsers: prev.selectedUsers.includes(userId)
        ? prev.selectedUsers.filter((id) => id !== userId)
        : [...prev.selectedUsers, userId],
    }));
  };

  // Stats
  const activeProjects = projects.filter((p) => p.phase !== "Finalizado").length;
  const adminUsers = users.filter((u) => u.role === "admin").length;
  const totalAssignments = projects.reduce((acc, p) => acc + p.memberCount, 0);
  const demoUsersCount = users.filter((u) => u.isDemo).length;
  const budgetingUsersCount = users.filter((u) => u.budgetingAccess).length;
  const budgetingAdoptionPct = users.length > 0 ? Math.round((budgetingUsersCount / users.length) * 100) : 0;
  const newUsersThisWeek = users.filter((u) => {
    const ms = u.createdAt?.toMillis?.();
    return typeof ms === "number" && Date.now() - ms <= 7 * 24 * 60 * 60 * 1000;
  }).length;

  // ── Cuentas en riesgo: tres señales baratas de calcular a partir de datos
  // que ya se cargan, ninguna requiere infraestructura nueva. ────────────────
  const STALE_PROJECT_DAYS = 30;
  const STALE_INVITE_DAYS = 14;
  const staleProjects = projects.filter((p) => {
    if (p.phase === "Finalizado") return false; // un proyecto acabado se queda quieto a propósito
    const refMs = p.lastActivityAt?.toMillis?.() ?? p.createdAt?.toMillis?.();
    if (!refMs) return true; // sin ninguna fecha de referencia: se trata como riesgo
    return Date.now() - refMs > STALE_PROJECT_DAYS * 24 * 60 * 60 * 1000;
  });
  const staleInvitations = pendingInvitations.filter((inv) => {
    const ms = inv.createdAt?.toMillis?.();
    return typeof ms === "number" && Date.now() - ms > STALE_INVITE_DAYS * 24 * 60 * 60 * 1000;
  });
  const emptyProducers = producers.filter((p) => !p.users || p.users.length === 0);
  const atRiskCount = staleProjects.length + staleInvitations.length + emptyProducers.length;

  const filteredProjectsForMessage = projects.filter((p) =>
    p.name.toLowerCase().includes(projectSearchInMessage.toLowerCase())
  );

  const filteredUsersForMessage = users.filter((u) =>
    u.name.toLowerCase().includes(userSearchInMessage.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearchInMessage.toLowerCase())
  );

  // ── Segmentos guardados para la difusión: listas que se recalculan solas
  // a partir de datos que ya se cargan, en vez de tener que reconstruir a
  // mano la lista de emails cada vez. ─────────────────────────────────────
  const staleProjectMemberIds = new Set(staleProjects.flatMap((p) => (p.members || []).map((m) => m.odId)));
  const SEGMENT_PRESETS: { id: string; label: string; sub: string; userIds: string[] }[] = [
    { id: "budgeting", label: "Con acceso a Budgeting", sub: `${budgetingUsersCount} usuarios`, userIds: users.filter((u) => u.budgetingAccess).map((u) => u.id) },
    { id: "demo", label: "Usuarios demo", sub: `${demoUsersCount} usuarios`, userIds: users.filter((u) => u.isDemo).map((u) => u.id) },
    { id: "admins", label: "Administradores", sub: `${adminUsers} usuarios`, userIds: users.filter((u) => u.role === "admin").map((u) => u.id) },
    { id: "stale", label: "De proyectos callados", sub: `${staleProjectMemberIds.size} usuarios · ${staleProjects.length} proyectos sin actividad`, userIds: users.filter((u) => staleProjectMemberIds.has(u.id)).map((u) => u.id) },
  ];

  const recipientCount = (() => {
    if (messageForm.recipientMode === "all") return users.length;
    if (messageForm.recipientMode === "users") return messageForm.selectedUsers.length;
    if (messageForm.recipientMode === "segment") return SEGMENT_PRESETS.find((s) => s.id === messageForm.selectedSegment)?.userIds.length || 0;
    const userIdSet = new Set<string>();
    projects.filter((p) => messageForm.selectedProjects.includes(p.id)).forEach((project) => {
      project.members?.forEach((member) => userIdSet.add(member.odId));
    });
    return userIdSet.size;
  })();

  const filteredProjects = projects.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(projectSearch.toLowerCase());
    const matchesPhase = projectPhaseFilter === "all" || p.phase === projectPhaseFilter;
    return matchesSearch && matchesPhase;
  });

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase());
    const matchesRole = userRoleFilter === "all" || u.role === userRoleFilter;
    return matchesSearch && matchesRole;
  });

  const filteredProducers = producers.filter((p) => p.name.toLowerCase().includes(producerSearch.toLowerCase()));

  // ── Buscador único: mismo texto, tres colecciones a la vez. ────────────────
  const globalSearchQuery = globalSearch.trim().toLowerCase();
  const globalSearchResults = globalSearchQuery.length < 2 ? { projects: [], users: [], producers: [] } : {
    projects: projects.filter((p) => p.name.toLowerCase().includes(globalSearchQuery) || p.id.toLowerCase().includes(globalSearchQuery)).slice(0, 5),
    users: users.filter((u) => u.name.toLowerCase().includes(globalSearchQuery) || u.email.toLowerCase().includes(globalSearchQuery)).slice(0, 5),
    producers: producers.filter((p) => p.name.toLowerCase().includes(globalSearchQuery)).slice(0, 5),
  };
  const globalSearchHasResults = globalSearchResults.projects.length + globalSearchResults.users.length + globalSearchResults.producers.length > 0;
  const openSupportChats = supportChats.filter((c) => c.status === "open").length;
  const unassignedSupportChats = supportChats.filter((c) => c.status === "open" && !c.assignedTo).length;
  const myOpenSupportChats = supportChats.filter((c) => c.status === "open" && c.assignedTo === contextUser?.uid).length;
  const resolvedTodaySupportChats = supportChats.filter((c) => {
    if (c.status !== "resolved" || !c.resolvedAt) return false;
    const now = new Date();
    const resolved = c.resolvedAt.toDate();
    return resolved.toDateString() === now.toDateString();
  }).length;
  const formatDate = (ts?: Timestamp | null) =>
    ts && typeof (ts as any).toDate === "function"
      ? ts.toDate().toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
      : "—";

  // Para el aviso de "lleva X sin respuesta" en la cola de soporte.
  const timeSince = (ts?: Timestamp | null): string => {
    const ms = ts?.toMillis?.();
    if (!ms) return "";
    const diffMin = Math.floor((Date.now() - ms) / 60000);
    if (diffMin < 1) return "ahora mismo";
    if (diffMin < 60) return `${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} h`;
    return `${Math.floor(diffH / 24)} d`;
  };

  // Loading
  if (loading || userLoading) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={"min-h-screen bg-white " + inter.className}>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg ${
              toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
            } text-white`}
          >
            {toast.type === "success" ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}

      {/* ── Shell: sidebar + content ─────────────────────────────────────── */}
      <div className="mt-[53px] flex items-stretch" style={{ minHeight: "calc(100vh - 53px)" }}>

        {/* Sidebar */}
        <aside className="w-60 flex-shrink-0 bg-slate-950 border-r border-slate-800/60 flex flex-col">
          <div className="px-5 py-5 border-b border-slate-800/60">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-[10px] text-emerald-400 tracking-widest uppercase">System online</span>
            </div>
            <h1 className="text-white font-bold text-lg leading-tight">
              admin<span className="text-slate-600">.</span>console
            </h1>
            <p className="font-mono text-[10px] text-slate-500 mt-1">filma-workspace / root</p>
          </div>

          {isAdmin && (
            <div className="px-3 pt-3 relative" ref={globalSearchRef}>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
                <input
                  type="text"
                  value={globalSearch}
                  onChange={(e) => { setGlobalSearch(e.target.value); setShowGlobalSearchResults(true); }}
                  onFocus={() => setShowGlobalSearchResults(true)}
                  placeholder="Buscar en todo"
                  className="w-full pl-8 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-600"
                />
              </div>
              {showGlobalSearchResults && globalSearchQuery.length >= 2 && (
                <div className="absolute left-3 right-3 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 py-1.5 max-h-96 overflow-y-auto">
                  {!globalSearchHasResults ? (
                    <p className="px-3 py-3 text-xs text-slate-400 text-center">Sin resultados para "{globalSearch}"</p>
                  ) : (
                    <>
                      {globalSearchResults.projects.length > 0 && (
                        <div className="mb-1">
                          <p className="px-3 pt-1 pb-1 text-[9.5px] font-semibold text-slate-400 uppercase tracking-wide">Proyectos</p>
                          {globalSearchResults.projects.map((p) => (
                            <Link
                              key={p.id}
                              href={`/admindashboard/project/${p.id}`}
                              onClick={() => { setShowGlobalSearchResults(false); setGlobalSearch(""); }}
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-xs text-slate-700"
                            >
                              <Briefcase size={12} className="text-slate-400 flex-shrink-0" />
                              <span className="truncate font-medium">{p.name}</span>
                              <span className="ml-auto text-[10px] text-slate-400 flex-shrink-0">{p.phase}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                      {globalSearchResults.users.length > 0 && (
                        <div className="mb-1 border-t border-slate-100 pt-1">
                          <p className="px-3 pt-1 pb-1 text-[9.5px] font-semibold text-slate-400 uppercase tracking-wide">Usuarios</p>
                          {globalSearchResults.users.map((u) => (
                            <button
                              key={u.id}
                              onClick={() => { setActiveTab("users"); setShowUserDetails(u.id); setShowGlobalSearchResults(false); setGlobalSearch(""); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-xs text-slate-700 text-left"
                            >
                              <Users size={12} className="text-slate-400 flex-shrink-0" />
                              <span className="truncate font-medium">{u.name}</span>
                              <span className="ml-auto text-[10px] text-slate-400 truncate flex-shrink-0 max-w-[110px]">{u.email}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {globalSearchResults.producers.length > 0 && (
                        <div className="border-t border-slate-100 pt-1">
                          <p className="px-3 pt-1 pb-1 text-[9.5px] font-semibold text-slate-400 uppercase tracking-wide">Productoras</p>
                          {globalSearchResults.producers.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => { setActiveTab("producers"); setProducerSearch(p.name); setShowGlobalSearchResults(false); setGlobalSearch(""); }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-xs text-slate-700 text-left"
                            >
                              <Building2 size={12} className="text-slate-400 flex-shrink-0" />
                              <span className="truncate font-medium">{p.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <nav className="flex-1 px-2.5 py-4 space-y-0.5 overflow-y-auto">
            {NAV_SECTIONS.filter((s) => isAdmin || s.id === "support").map((item) => {
              const count =
                item.id === "projects" ? projects.length :
                item.id === "users" ? users.length :
                item.id === "producers" ? producers.length :
                item.id === "support" ? totalUnreadSupport :
                0;
              const alert = item.id === "support" && totalUnreadSupport > 0;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active ? "bg-slate-800/80 text-white" : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                >
                  {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-emerald-400" />}
                  <item.icon size={15} className={active ? "text-emerald-400" : "text-slate-500"} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {count > 0 && (
                    <span
                      className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                        alert ? "bg-red-500/20 text-red-400" : active ? "bg-white/10 text-slate-300" : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            {hasAdminAccess && (
              <Link
                href="/admindashboard/guides"
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
              >
                <BookOpen size={15} className="text-slate-500" />
                <span className="flex-1 text-left">Guías</span>
              </Link>
            )}
          </nav>

          <div className="px-3 py-4 border-t border-slate-800/60 space-y-1">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-900 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              Refrescar datos
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowMessageModal(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
              >
                <MessageSquare size={13} />
                Emitir mensaje
              </button>
            )}
            {hasAdminAccess && (
              <button
                onClick={openAutomatedMessagesModal}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-900 transition-colors"
              >
                <Settings size={13} />
                Mensajes automáticos
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => { setMaintenanceMinutes(10); setMaintenanceMessage(maintenance.message); setShowMaintenanceModal(true); }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  maintenance.enabled ? "text-amber-400 hover:text-amber-300 bg-amber-950/40" : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                <Wrench size={13} />
                Modo mantenimiento
                {maintenance.enabled && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400" />}
              </button>
            )}
            <div className="pt-3 mt-2 border-t border-slate-800/60 flex items-center gap-2 px-3">
              <div className="w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center text-[10px] font-semibold text-slate-300 flex-shrink-0">
                {(contextUser?.name || contextUser?.email || "A").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-300 truncate">{contextUser?.name || "Admin"}</p>
                <p className="font-mono text-[10px] text-slate-600 truncate">
                  {isSupportAgent
                    ? `Agente · ${SPECIALTY_LABEL[agents.find((a) => a.id === contextUser?.uid)?.supportSpecialty || "both"]}`
                    : contextUser?.email}
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 bg-slate-50/60 flex flex-col">

          {/* Stat strip */}
          <div className="px-8 py-5 bg-white border-b border-slate-200">
            {isAdmin ? (
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(8, minmax(0,1fr))" }}>
                <StatTile icon={Briefcase} label="Proyectos" value={projects.length} sub={`${activeProjects} activos`} accent="blue" />
                <StatTile icon={Users} label="Usuarios" value={users.length} sub={`${adminUsers} admin · ${demoUsersCount} demo`} accent="violet" />
                <StatTile icon={UserPlus} label="Nuevos (7d)" value={newUsersThisWeek} sub="últimos 7 días" accent={newUsersThisWeek > 0 ? "emerald" : "slate"} />
                <StatTile icon={Calculator} label="Budgeting" value={budgetingUsersCount} sub={`${budgetingAdoptionPct}% de adopción`} accent="violet" />
                <StatTile icon={Building2} label="Productoras" value={producers.length} accent="amber" />
                <StatTile icon={CheckSquare} label="Asignaciones" value={totalAssignments} sub="miembros × proyecto" accent="emerald" />
                <StatTile
                  icon={HeadphonesIcon}
                  label="Soporte"
                  value={supportChats.length}
                  sub={`${openSupportChats} abiertos`}
                  accent={totalUnreadSupport > 0 ? "red" : "slate"}
                />
                <StatTile
                  icon={UserCheck}
                  label="Sin asignar"
                  value={unassignedSupportChats}
                  sub="en cola"
                  accent={unassignedSupportChats > 0 ? "amber" : "slate"}
                />
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
                <StatTile icon={UserCheck} label="Sin asignar" value={unassignedSupportChats} sub="en cola para todos" accent={unassignedSupportChats > 0 ? "amber" : "slate"} />
                <StatTile icon={HeadphonesIcon} label="Mis tickets" value={myOpenSupportChats} sub="abiertos" accent="blue" />
                <StatTile icon={CheckCheck} label="Resueltos hoy" value={resolvedTodaySupportChats} accent="emerald" />
              </div>
            )}
          </div>

          <main className="flex-1 px-8 py-6 overflow-x-hidden">
            {/* Section eyebrow */}
            <div className="mb-5">
              <p className="font-mono text-[10px] text-slate-400 tracking-widest uppercase mb-1">// {activeTab}</p>
              <h2 className="text-xl font-bold text-slate-900">
                {NAV_SECTIONS.find((s) => s.id === activeTab)?.label}
              </h2>
            </div>

        {/* ==================== PROJECTS TAB ==================== */}
        {activeTab === "projects" && (
          <div>
            {/* Cuentas en riesgo: tres señales calculadas de datos que ya se cargan (sin actividad reciente, invitación olvidada, productora sin usuarios) — clic para ver la lista de cada una. */}
            {atRiskCount > 0 && (
              <div className="mb-6 border border-amber-200 bg-amber-50/50 rounded-xl overflow-hidden">
                <div className="grid grid-cols-3 divide-x divide-amber-200">
                  {([
                    { key: "stale" as const, label: "Proyectos callados", value: staleProjects.length, sub: `${STALE_PROJECT_DAYS}+ días sin actividad` },
                    { key: "invites" as const, label: "Invitaciones olvidadas", value: staleInvitations.length, sub: `${STALE_INVITE_DAYS}+ días sin aceptar` },
                    { key: "producers" as const, label: "Productoras vacías", value: emptyProducers.length, sub: "sin usuarios asignados" },
                  ]).map((item) => (
                    <button
                      key={item.key}
                      onClick={() => item.value > 0 && setShowAtRisk(showAtRisk === item.key ? null : item.key)}
                      disabled={item.value === 0}
                      className={`px-4 py-3 text-left transition-colors disabled:opacity-40 disabled:cursor-default ${
                        showAtRisk === item.key ? "bg-amber-100" : item.value > 0 ? "hover:bg-amber-100/70" : ""
                      }`}
                    >
                      <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">{item.label}</p>
                      <p className="text-xl font-bold text-amber-900 font-mono tabular-nums leading-tight">{item.value}</p>
                      <p className="text-[10px] text-amber-600">{item.sub}</p>
                    </button>
                  ))}
                </div>
                {showAtRisk && (
                  <div className="border-t border-amber-200 bg-white px-4 py-3 max-h-56 overflow-y-auto">
                    {showAtRisk === "stale" && (
                      <>
                        <button
                          onClick={() => {
                            setMessageForm({
                              content: `Hola 👋 Hemos visto que hace tiempo que no tocas tu proyecto en Filma Workspace. Si necesitas ayuda para retomarlo, escríbenos — estamos aquí para lo que haga falta.`,
                              recipientMode: "segment",
                              selectedProjects: [],
                              selectedUsers: [],
                              selectedSegment: "stale",
                              duration: "indefinite",
                              sendByEmail: true,
                            });
                            setShowMessageModal(true);
                          }}
                          className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 hover:text-blue-800 mb-2"
                        >
                          <Send size={11} />
                          Avisar a estos proyectos
                        </button>
                        <ul className="space-y-1.5">
                          {staleProjects.map((p) => (
                            <li key={p.id} className="flex items-center justify-between gap-3 text-xs">
                              <Link href={`/admindashboard/project/${p.id}`} className="text-slate-700 hover:underline font-medium truncate">{p.name}</Link>
                              <span className="text-slate-400 font-mono flex-shrink-0">{p.lastActivityAt ? formatDate(p.lastActivityAt) : "sin actividad registrada"}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {showAtRisk === "invites" && (
                      <ul className="space-y-1.5">
                        {staleInvitations.map((inv) => (
                          <li key={inv.id} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-slate-700 truncate">{inv.email}</span>
                            <span className="text-slate-400 truncate flex-shrink-0">{inv.projectName}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {showAtRisk === "producers" && (
                      <ul className="space-y-1.5">
                        {emptyProducers.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-slate-700 font-medium truncate">{p.name}</span>
                            <button onClick={() => { setActiveTab("producers"); setShowAssignCompanyUser(p.id); }} className="text-slate-500 hover:text-slate-900 hover:underline flex-shrink-0">Asignar usuario</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Toolbar */}
            <div className="flex flex-row gap-3 items-center justify-between mb-6">
              <div className="flex flex-row gap-3 flex-1 w-auto">
                <div className="relative flex-1 max-w-xs">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar proyectos"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm bg-white"
                  />
                </div>
                {/* Phase Dropdown */}
                <div className="relative" ref={phaseDropdownRef}>
                  <button
                    onClick={() => setShowPhaseDropdown(!showPhaseDropdown)}
                    className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-colors min-w-[160px] ${
                      projectPhaseFilter !== "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                    }`}
                  >
                    <span className="flex-1 text-left truncate">{projectPhaseFilter === "all" ? "Todas las fases" : projectPhaseFilter}</span>
                    <ChevronDown size={14} className={`transition-transform ${showPhaseDropdown ? "rotate-180" : ""} ${projectPhaseFilter !== "all" ? "text-white" : "text-slate-400"}`} />
                  </button>
                  {showPhaseDropdown && (
                    <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                      <button
                        onClick={() => { setProjectPhaseFilter("all"); setShowPhaseDropdown(false); }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                          projectPhaseFilter === "all" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        Todas las fases
                      </button>
                      {PHASES.map((phase) => (
                        <button
                          key={phase}
                          onClick={() => { setProjectPhaseFilter(phase); setShowPhaseDropdown(false); }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                            projectPhaseFilter === phase ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {phase}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => setShowCreateProject(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium"
              >
                <FolderPlus size={14} />
                Crear proyecto
              </button>
            </div>

            {/* Projects Content */}
            {filteredProjects.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-sm">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FolderOpen size={28} className="text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-6">No hay proyectos</h3>
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                >
                  <FolderPlus size={16} />
                  Crear proyecto
                </button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tl-xl">Proyecto</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">ID</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Fase</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Productoras</th>
                      <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Miembros</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Creado</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tr-xl">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProjects.map((project) => {
                      const phase = phaseConfig[project.phase] || phaseConfig["Desarrollo"];
                      return (
                        <tr key={project.id} className="group hover:bg-slate-50/60">
                          <td className="px-4 py-3 max-w-[260px]">
                            <p className="font-medium text-slate-900 truncate">{project.name}</p>
                            {project.description && (
                              <p className="text-xs text-slate-400 truncate">{project.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-[11px] text-slate-500">{project.id}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-lg whitespace-nowrap ${phase.bg} ${phase.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${phase.dot}`} />
                              {project.phase}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500 max-w-[180px] truncate">
                            {project.producerNames && project.producerNames.length > 0 ? project.producerNames.join(", ") : "—"}
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-slate-700">{project.memberCount}</td>
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">{formatDate(project.createdAt)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-0.5">
                              <Link
                                href={`/admindashboard/project/${project.id}`}
                                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                                title="Gestionar"
                              >
                                <Eye size={14} />
                              </Link>
                              <Link
                                href={`/project/${project.id}`}
                                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                                title="Ir al proyecto"
                              >
                                <ExternalLink size={14} />
                              </Link>
                              <div className="relative" ref={activeMenu === project.id ? menuRef : null}>
                                <button
                                  onClick={() => setActiveMenu(activeMenu === project.id ? null : project.id)}
                                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                                >
                                  <MoreHorizontal size={14} />
                                </button>
                                {activeMenu === project.id && (
                                  <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1">
                                    <button
                                      onClick={() => {
                                        setNewProject({
                                          name: project.name,
                                          description: project.description || "",
                                          phase: project.phase,
                                          producers: project.producers || [],
                                          customId: "",
                                          useCustomId: false,
                                          language: (project as any).language || "es",
                                        });
                                        setShowEditProject(project.id);
                                        setActiveMenu(null);
                                      }}
                                      className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                    >
                                      <Edit2 size={14} className="text-slate-400" />
                                      Editar
                                    </button>
                                    <Link
                                      href={`/project/${project.id}/config`}
                                      onClick={() => setActiveMenu(null)}
                                      className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                    >
                                      <Settings size={14} className="text-slate-400" />
                                      Config
                                    </Link>
                                    <div className="border-t border-slate-100 my-1" />
                                    <button
                                      onClick={() => handleDeleteProject(project.id)}
                                      className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                    >
                                      <Trash2 size={14} />
                                      Eliminar
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ==================== USERS TAB ==================== */}
        {activeTab === "users" && (
          <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex flex-row gap-3 items-center mb-6">
              <div className="relative flex-1 max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar usuarios"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm bg-white"
                />
              </div>
              {/* Role Dropdown */}
              <div className="relative" ref={roleDropdownRef}>
                <button
                  onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                  className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-colors min-w-[160px] ${
                    userRoleFilter !== "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                  }`}
                >
                  <span className="flex-1 text-left truncate">
                    {userRoleFilter === "all" ? "Todos los roles" : userRoleFilter === "admin" ? "Administradores" : userRoleFilter === "support_agent" ? "Agentes de soporte" : "Usuarios"}
                  </span>
                  <ChevronDown size={14} className={`transition-transform ${showRoleDropdown ? "rotate-180" : ""} ${userRoleFilter !== "all" ? "text-white" : "text-slate-400"}`} />
                </button>
                {showRoleDropdown && (
                  <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                    <button
                      onClick={() => { setUserRoleFilter("all"); setShowRoleDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        userRoleFilter === "all" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Todos los roles
                    </button>
                    <button
                      onClick={() => { setUserRoleFilter("admin"); setShowRoleDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        userRoleFilter === "admin" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Administradores
                    </button>
                    <button
                      onClick={() => { setUserRoleFilter("support_agent"); setShowRoleDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        userRoleFilter === "support_agent" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Agentes de soporte
                    </button>
                    <button
                      onClick={() => { setUserRoleFilter("user"); setShowRoleDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        userRoleFilter === "user" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Usuarios
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={openCreateAgentModal}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 ml-auto"
              >
                <HeadphonesIcon size={14} />
                Nuevo agente
              </button>
              <button
                onClick={openDemoModal}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-700"
              >
                <UserPlus size={14} />
                Usuario demo
              </button>
              <button
                onClick={handleExportUsersCSV}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download size={14} />
                Exportar CSV
              </button>
            </div>

            {/* Users Table */}
            {filteredUsers.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <Users size={28} className="text-slate-300 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-900">No hay usuarios</h3>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tl-xl">Usuario</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">ID</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Teléfono</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Rol</th>
                      <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Proyectos</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tr-xl">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600 text-xs font-semibold flex-shrink-0">
                              {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
                                {user.isDemo && (
                                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[9px] font-medium flex-shrink-0">Demo</span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 truncate">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><span className="font-mono text-[11px] text-slate-400">{user.id}</span></td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{user.phone || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="relative" ref={showRoleMenuFor === user.id ? roleMenuRef : null}>
                            <button
                              onClick={() => setShowRoleMenuFor(showRoleMenuFor === user.id ? null : user.id)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors ${
                                user.role === "admin"
                                  ? "bg-violet-50 text-violet-700 hover:bg-violet-100"
                                  : user.role === "support_agent"
                                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                              }`}
                            >
                              {user.role === "admin" && <Shield size={10} />}
                              {user.role === "support_agent" && <HeadphonesIcon size={10} />}
                              {user.role === "admin" ? "Admin" : user.role === "support_agent" ? SPECIALTY_LABEL[user.supportSpecialty || "both"] : "Usuario"}
                              <ChevronDown size={10} />
                            </button>
                            {showRoleMenuFor === user.id && (
                              <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1">
                                <button onClick={() => handleChangeUserRole(user.id, "user")} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                                  Usuario
                                </button>
                                <button onClick={() => handleChangeUserRole(user.id, "admin")} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                                  <Shield size={12} className="text-violet-500" />
                                  Administrador
                                </button>
                                <div className="border-t border-slate-100 my-1" />
                                <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Agente de soporte</p>
                                <button onClick={() => handleChangeUserRole(user.id, "support_agent", "sales")} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                                  Ventas
                                </button>
                                <button onClick={() => handleChangeUserRole(user.id, "support_agent", "technical")} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                                  Soporte técnico
                                </button>
                                <button onClick={() => handleChangeUserRole(user.id, "support_agent", "both")} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                                  Ventas + Soporte
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => setShowUserDetails(user.id)} className="font-mono text-xs text-slate-600 hover:text-slate-900 hover:underline">
                            {user.projectCount}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              onClick={() => setShowUserDetails(user.id)}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                              title="Ver detalle"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteUser(user.id)}
                              disabled={saving}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              title="Eliminar usuario"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ==================== PRODUCERS TAB ==================== */}
        {activeTab === "producers" && (
          <div>
            {/* Toolbar */}
            <div className="flex flex-row gap-3 items-center justify-between mb-6">
              <div className="relative flex-1 max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar productoras"
                  value={producerSearch}
                  onChange={(e) => setProducerSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm bg-white"
                />
              </div>
              <button
                onClick={() => setShowCreateProducer(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium"
              >
                <Plus size={14} />
                Nueva productora
              </button>
            </div>

            {/* Producers Grid */}
            {filteredProducers.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <Building2 size={28} className="text-slate-300 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-900 mb-4">No hay productoras</h3>
                <button
                  onClick={() => setShowCreateProducer(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                >
                  <Plus size={14} />
                  Nueva
                </button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tl-xl">Productora</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">ID</th>
                      <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Proyectos</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Usuarios asignados</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tr-xl">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProducers.map((producer) => (
                      <tr key={producer.id} className="hover:bg-slate-50/60 align-top">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Building2 size={14} className="text-slate-400 flex-shrink-0" />
                            <span className="text-sm font-medium text-slate-900">{producer.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3"><span className="font-mono text-[11px] text-slate-400">{producer.id}</span></td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-slate-700">{producer.projectCount}</td>
                        <td className="px-4 py-3">
                          {producer.users && producer.users.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {producer.users.map((user) => (
                                <div
                                  key={user.id}
                                  className="flex items-center gap-1.5 pl-1.5 pr-1 py-1 bg-emerald-50 border border-emerald-200 rounded-lg group"
                                >
                                  <div className="w-4 h-4 bg-emerald-100 rounded flex items-center justify-center text-emerald-700 text-[9px] font-medium flex-shrink-0">
                                    {user.name.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="text-[11px] text-emerald-700">{user.name}</span>
                                  <button
                                    onClick={() => handleRemoveCompanyUser(user.id)}
                                    className="p-0.5 text-emerald-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-0.5">
                            <Link
                              href={`/companydashboard/${producer.id}`}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="Ver panel de productora"
                            >
                              <Eye size={14} />
                            </Link>
                            <button
                              onClick={() => setShowAssignCompanyUser(producer.id)}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg"
                              title="Añadir usuario de productora"
                            >
                              <UserPlus size={14} />
                            </button>
                            <button
                              onClick={() => {
                                setNewProducer({ name: producer.name });
                                setShowEditProducer(producer.id);
                              }}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteProducer(producer.id)}
                              disabled={saving || producer.projectCount > 0}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                              title={producer.projectCount > 0 ? "Tiene proyectos" : "Eliminar"}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}


        {/* ==================== SUPPORT TAB ==================== */}
        {activeTab === "support" && (() => {
          const myId = contextUser?.uid;
          const openChats = supportChats.filter((c) => c.status === "open");
          const unassignedChats = openChats.filter((c) => !c.assignedTo);
          const myChats = openChats.filter((c) => c.assignedTo === myId);
          const resolvedChats = supportChats.filter((c) => c.status === "resolved");
          const visibleChats =
            supportQueueFilter === "unassigned" ? unassignedChats :
            supportQueueFilter === "mine" ? myChats :
            supportQueueFilter === "resolved" ? resolvedChats :
            isAdmin ? openChats : [...myChats, ...unassignedChats];

          const queueTabs = [
            { id: "unassigned" as const, label: "Sin asignar", count: unassignedChats.length },
            { id: "mine" as const, label: "Mías", count: myChats.length },
            ...(isAdmin ? [{ id: "all" as const, label: "Todas", count: openChats.length }] : []),
            { id: "resolved" as const, label: "Cerradas", count: resolvedChats.length },
          ];

          return (
          <div className="flex gap-4" style={{ height: "calc(100vh - 320px)", minHeight: 480 }}>

            {/* Chat list */}
            <div className="w-80 flex-shrink-0 bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden">
              <div className="px-3 py-3 border-b border-slate-100">
                <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                  {queueTabs.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSupportQueueFilter(f.id)}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                        supportQueueFilter === f.id ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {f.label}
                      {f.count > 0 && <span className="font-mono text-[10px] text-slate-400">{f.count}</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                {visibleChats.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                    <HeadphonesIcon size={24} className="text-slate-300" />
                    <p className="text-xs text-slate-400">Nada por aquí</p>
                  </div>
                )}
                {visibleChats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => setActiveChatId(chat.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors hover:bg-slate-50 ${
                      activeChatId === chat.id ? "bg-slate-50 border-l-2 border-slate-800" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-slate-900 truncate">{chat.userName}</p>
                          {chat.ticketNumber && (
                            <span className="text-[9px] text-slate-400 font-mono flex-shrink-0">
                              #{String(chat.ticketNumber).padStart(5, "0")}
                            </span>
                          )}
                          {chat.department && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium bg-slate-100 text-slate-500">
                              {chat.department === "sales" ? "Ventas" : "Técnico"}
                            </span>
                          )}
                          {chat.status === "resolved" && (
                            <span className="text-[9px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
                              Cerrado
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 truncate mt-0.5">{chat.lastMessage || "Sin mensajes"}</p>
                        {chat.status === "open" && (
                          chat.assignedTo ? (
                            <p className="text-[10px] mt-1 font-medium text-blue-600 truncate">→ {chat.assignedToName}</p>
                          ) : (
                            <p className="text-[10px] mt-1 font-medium text-amber-600">Sin asignar</p>
                          )
                        )}
                        {chat.status === "open" && chat.unreadAdmin > 0 && chat.lastMessageAt && (
                          <p className="text-[10px] mt-0.5 font-medium text-red-500">Esperando desde hace {timeSince(chat.lastMessageAt)}</p>
                        )}
                      </div>
                      {chat.unreadAdmin > 0 && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                    {chat.lastMessageAt && (
                      <p className="text-[10px] text-slate-300 mt-1">
                        {chat.lastMessageAt.toDate().toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                        {" · "}
                        {chat.lastMessageAt.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation */}
            {activeChatId ? (() => {
              const activeChat = supportChats.find((c) => c.id === activeChatId);
              if (!activeChat) return null;
              const isMine = activeChat.assignedTo === myId;
              const isUnassigned = !activeChat.assignedTo;
              const canReply = isAdmin || isMine;
              const otherAgents = agents.filter((a) => a.id !== activeChat.assignedTo);
              return (
                <div className="flex-1 bg-white border border-slate-200 rounded-2xl flex flex-col">
                  {/* Conv header */}
                  <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50 flex-wrap gap-2 rounded-t-2xl">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{activeChat.userName}</p>
                        {activeChat.ticketNumber && (
                          <span className="text-[10px] text-slate-400 font-mono">#{String(activeChat.ticketNumber).padStart(5, "0")}</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{activeChat.userEmail}</p>
                      {activeChat.currentPage && (
                        <p className="text-[10px] text-slate-400 font-mono truncate max-w-[260px]" title={activeChat.currentPage}>
                          📍 {activeChat.currentPage}
                        </p>
                      )}
                      <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                        {activeChat.contactType && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium bg-white border-slate-200 text-slate-600">
                            {activeChat.contactType === "company" ? "🎬 Productora" : "👤 Persona"}
                          </span>
                        )}
                        {activeChat.department && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium bg-white border-slate-200 text-slate-600">
                            {activeChat.department === "sales" ? "💼 Ventas" : "🛠️ Técnico"}
                          </span>
                        )}
                        {activeChat.contactType === "company" && activeChat.interestedInFW !== null && activeChat.interestedInFW !== undefined && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                            activeChat.interestedInFW
                              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                              : "bg-slate-50 border-slate-200 text-slate-500"
                          }`}>
                            {activeChat.interestedInFW ? "✓ Interesada en Filma" : "No interesada en Filma"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {activeChat.status === "open" && (
                        isUnassigned ? (
                          <button
                            onClick={() => handleClaimChat(activeChat.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition-colors"
                          >
                            <UserCheck size={13} />
                            Atender ticket
                          </button>
                        ) : (
                          <>
                            <span className="text-[11px] text-slate-500 font-medium px-1">→ {activeChat.assignedToName}</span>
                            {(isMine || isAdmin) && (
                              <div className="relative" ref={showTransferMenu === activeChat.id ? transferMenuRef : null}>
                                <button
                                  onClick={() => setShowTransferMenu(showTransferMenu === activeChat.id ? null : activeChat.id)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                                >
                                  <RefreshCw size={12} />
                                  Transferir
                                </button>
                                {showTransferMenu === activeChat.id && (
                                  <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1 max-h-56 overflow-y-auto">
                                    {otherAgents.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No hay otros agentes</p>}
                                    {otherAgents.map((a) => (
                                      <button
                                        key={a.id}
                                        onClick={() => handleTransferChat(activeChat.id, a.id)}
                                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center justify-between gap-2"
                                      >
                                        <span className="truncate">{a.name}</span>
                                        {a.supportSpecialty && (
                                          <span className="text-[9px] text-slate-400 flex-shrink-0">{SPECIALTY_LABEL[a.supportSpecialty]}</span>
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )
                      )}
                      {activeChat.status === "open" && canReply && (
                        <div className="relative" ref={showGuidePicker === activeChat.id ? guidePickerRef : null}>
                          <button
                            onClick={() => setShowGuidePicker(showGuidePicker === activeChat.id ? null : activeChat.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                          >
                            <BookOpen size={12} />
                            Guía
                          </button>
                          {showGuidePicker === activeChat.id && (
                            <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1.5 max-h-72 overflow-y-auto">
                              <div className="px-2 pb-1.5">
                                <input
                                  value={guidePickerSearch}
                                  onChange={(e) => setGuidePickerSearch(e.target.value)}
                                  placeholder="Buscar guía"
                                  autoFocus
                                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-300"
                                />
                              </div>
                              {publishedGuides
                                .filter((g) => g.title.toLowerCase().includes(guidePickerSearch.toLowerCase()))
                                .map((g) => (
                                  <button
                                    key={g.id}
                                    onClick={() => handleInsertGuide(activeChat.id, g)}
                                    className="w-full px-3 py-2 text-left hover:bg-slate-50"
                                  >
                                    <p className="text-xs font-medium text-slate-800 truncate">{g.title}</p>
                                    <p className="text-[10px] text-slate-400">{g.category}</p>
                                  </button>
                                ))}
                              {publishedGuides.filter((g) => g.title.toLowerCase().includes(guidePickerSearch.toLowerCase())).length === 0 && (
                                <p className="px-3 py-2 text-xs text-slate-400">Sin guías publicadas</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {activeChat.status === "open" ? (
                        <button
                          onClick={() => handleResolveChat(activeChat.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium transition-colors"
                        >
                          <CheckCheck size={13} />
                          Cerrar
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReopenChat(activeChat.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                        >
                          <Circle size={11} />
                          Reabrir
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3 bg-slate-50">
                    {chatMessages.map((msg) => {
                      if (msg.system) {
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <span className="text-[10px] text-slate-500 bg-slate-200/70 px-3 py-1 rounded-full">{msg.text}</span>
                          </div>
                        );
                      }
                      const isAgentMsg = msg.sender === "admin";
                      if (msg.guide) {
                        return (
                          <div key={msg.id} className={`flex ${isAgentMsg ? "justify-end" : "justify-start"}`}>
                            <a
                              href={msg.guide.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="max-w-[75%] flex items-center gap-3 px-3.5 py-3 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all"
                            >
                              <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                                <BookOpen size={16} style={{ color: "#2F52E0" }} />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-slate-900 truncate">{msg.guide.title}</span>
                                <span className="flex items-center gap-1 text-xs" style={{ color: "#2F52E0" }}>
                                  Ver guía <ExternalLink size={11} />
                                </span>
                              </span>
                            </a>
                          </div>
                        );
                      }
                      return (
                        <div key={msg.id} className={`flex ${isAgentMsg ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[70%] ${!isAgentMsg ? "flex items-end gap-2" : ""}`}>
                            {!isAgentMsg && (
                              <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mb-0.5">
                                <span className="text-[10px] font-semibold text-slate-600">
                                  {msg.senderName?.[0]?.toUpperCase() ?? "U"}
                                </span>
                              </div>
                            )}
                            <div>
                              <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words ${
                                isAgentMsg
                                  ? "bg-slate-800 text-white rounded-br-sm"
                                  : "bg-white text-slate-800 border border-slate-200 rounded-bl-sm shadow-sm"
                              }`}>
                                {msg.text}
                              </div>
                              <p className={`text-[10px] text-slate-400 mt-1 ${isAgentMsg ? "text-right" : "text-left"}`}>
                                {msg.createdAt
                                  ? msg.createdAt.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
                                  : ""}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={supportMsgsRef} />
                  </div>

                  {/* Reply input */}
                  {activeChat.status === "open" ? (
                    canReply ? (
                      <div className="px-4 py-3.5 border-t border-slate-100 bg-white flex items-end gap-2 rounded-b-2xl">
                        <div className="relative flex-shrink-0" ref={macroPickerRef}>
                          <button
                            onClick={() => setShowMacroPicker((v) => !v)}
                            disabled={automatedMessages.macros.length === 0}
                            title="Respuestas rápidas"
                            className="p-2.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl disabled:opacity-30 disabled:hover:bg-transparent"
                          >
                            <MessageSquare size={16} />
                          </button>
                          {showMacroPicker && (
                            <div className="absolute bottom-full left-0 mb-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1.5 max-h-56 overflow-y-auto">
                              {automatedMessages.macros.map((macro) => (
                                <button
                                  key={macro.id}
                                  onClick={() => {
                                    setSupportInput((prev) => (prev.trim() ? `${prev}\n${macro.text}` : macro.text));
                                    setShowMacroPicker(false);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                >
                                  <p className="text-xs font-medium text-slate-800">{macro.label}</p>
                                  <p className="text-[10.5px] text-slate-400 truncate">{macro.text}</p>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <textarea
                          rows={1}
                          value={supportInput}
                          onChange={(e) => setSupportInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSupportReply(); } }}
                          placeholder="Escribe una respuesta..."
                          className="flex-1 resize-none text-sm px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent leading-relaxed"
                          style={{ maxHeight: 100 }}
                        />
                        <button
                          onClick={handleSupportReply}
                          disabled={!supportInput.trim() || supportSending}
                          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors flex-shrink-0"
                        >
                          {supportSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                          Enviar
                        </button>
                      </div>
                    ) : (
                      <div className="px-4 py-3 border-t border-slate-100 bg-white rounded-b-2xl">
                        <p className="text-xs text-center text-slate-400">
                          {isUnassigned ? "Atiende el ticket para poder responder" : `Asignado a ${activeChat.assignedToName} — solo puede responder ese agente`}
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="px-4 py-3 border-t border-slate-100 bg-white rounded-b-2xl">
                      <p className="text-xs text-center text-slate-400">Conversación cerrada</p>
                    </div>
                  )}
                </div>
              );
            })() : (
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-3 text-center">
                <HeadphonesIcon size={32} className="text-slate-300" />
                <p className="text-sm font-medium text-slate-500">Selecciona una conversación</p>
                <p className="text-xs text-slate-400">Las respuestas llegan al usuario en tiempo real</p>
              </div>
            )}
          </div>
          );
        })()}

        {activeTab === "system" && (
          <div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 mb-6 w-fit">
              {([
                { id: "cron" as const, label: "Cron de Horario" },
                { id: "audit" as const, label: "Registro de auditoría" },
                { id: "broadcast" as const, label: "Difusión" },
                { id: "flags" as const, label: "Flags de función" },
              ]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSystemSubTab(t.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${systemSubTab === t.id ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {systemDataLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : systemSubTab === "cron" ? (
              cronRuns.length === 0 ? (
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                  <Clock size={28} className="text-slate-300 mx-auto mb-3" />
                  <h3 className="font-semibold text-slate-900">Sin ejecuciones todavía</h3>
                  <p className="text-xs text-slate-400 mt-1">El cron corre cada 15 min; vuelve en un rato.</p>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tl-xl">Ejecutado</th>
                        <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Proyectos revisados</th>
                        <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Enviados</th>
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tr-xl">Errores</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cronRuns.map((run) => (
                        <tr key={run.id} className={run.errors.length > 0 ? "bg-red-50/40" : ""}>
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                            {run.runAt ? `${run.runAt.toDate().toLocaleDateString("es-ES", { day: "2-digit", month: "short" })} · ${run.runAt.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-slate-700">{run.checked}</td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-slate-700">{run.triggered.length}</td>
                          <td className="px-4 py-3">
                            {run.errors.length === 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium"><CheckCircle size={11} />OK</span>
                            ) : (
                              <div className="space-y-0.5">
                                {run.errors.map((e, i) => (
                                  <p key={i} className="text-[11px] text-red-600 font-mono truncate max-w-md">{e}</p>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : systemSubTab === "audit" ? (
              auditLog.length === 0 ? (
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                  <Shield size={28} className="text-slate-300 mx-auto mb-3" />
                  <h3 className="font-semibold text-slate-900">Sin acciones registradas todavía</h3>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {auditLog.map((entry) => (
                    <div key={entry.id} className="px-4 py-3 flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Shield size={12} className="text-slate-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-700"><span className="font-semibold text-slate-900">{entry.adminName}</span> · {AUDIT_ACTION_LABEL[entry.action] || entry.action}</p>
                        {entry.details && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{entry.details}</p>}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono flex-shrink-0 whitespace-nowrap">
                        {entry.createdAt ? `${entry.createdAt.toDate().toLocaleDateString("es-ES", { day: "2-digit", month: "short" })} · ${entry.createdAt.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )
            ) : systemSubTab === "broadcast" ? (
              (() => {
                const broadcasts = auditLog.filter((e) => e.action === "broadcast_sent");
                return broadcasts.length === 0 ? (
                  <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                    <Send size={28} className="text-slate-300 mx-auto mb-3" />
                    <h3 className="font-semibold text-slate-900">Sin envíos todavía</h3>
                    <p className="text-xs text-slate-400 mt-1">Usa "Emitir mensaje" en el menú lateral para mandar el primero.</p>
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {broadcasts.map((entry) => (
                      <div key={entry.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-medium text-slate-900">{entry.adminName}</p>
                          <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                            {entry.createdAt ? formatDate(entry.createdAt) : "—"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-1">{entry.details}</p>
                      </div>
                    ))}
                  </div>
                );
              })()
            ) : (
              <div className="max-w-2xl space-y-6">
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Crear flag</p>
                  <div className="flex gap-2">
                    <input
                      value={newFlagForm.label}
                      onChange={(e) => setNewFlagForm({ ...newFlagForm, label: e.target.value })}
                      placeholder="Nombre (p. ej. Escenas beta)"
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                    />
                    <button onClick={handleCreateFlag} disabled={saving} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 flex-shrink-0">
                      Crear
                    </button>
                  </div>
                  <input
                    value={newFlagForm.description}
                    onChange={(e) => setNewFlagForm({ ...newFlagForm, description: e.target.value })}
                    placeholder="Para qué sirve (opcional)"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>

                {Object.keys(featureFlags).length === 0 ? (
                  <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                    <Sparkles size={24} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">Sin flags todavía</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {Object.values(featureFlags).map((flag) => {
                      const enabledUsers = users.filter((u) => flag.enabledUserIds.includes(u.id));
                      const pickerUsers = users.filter((u) =>
                        !flag.enabledUserIds.includes(u.id) &&
                        (u.name.toLowerCase().includes(flagUserPickerSearch.toLowerCase()) || u.email.toLowerCase().includes(flagUserPickerSearch.toLowerCase()))
                      ).slice(0, 6);
                      return (
                        <div key={flag.id} className="bg-white border border-slate-200 rounded-xl p-4">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">{flag.label}</p>
                              {flag.description && <p className="text-xs text-slate-500 mt-0.5">{flag.description}</p>}
                            </div>
                            <button onClick={() => handleDeleteFlag(flag.id)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg flex-shrink-0" title="Eliminar flag">
                              <Trash2 size={13} />
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-100">
                            <p className="text-xs font-medium text-slate-700">Activado para todos</p>
                            <button
                              onClick={() => handleToggleFlagGlobal(flag.id, !flag.enabledGlobally)}
                              disabled={saving}
                              className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0 disabled:opacity-50"
                              style={{ background: flag.enabledGlobally ? "#0f172a" : "#e2e8f0" }}
                            >
                              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${flag.enabledGlobally ? "left-5" : "left-1"}`} />
                            </button>
                          </div>
                          {!flag.enabledGlobally && (
                            <div className="pt-2 border-t border-slate-100">
                              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Activado para usuarios concretos ({enabledUsers.length})</p>
                              {enabledUsers.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {enabledUsers.map((u) => (
                                    <span key={u.id} className="flex items-center gap-1 pl-2 pr-1 py-1 bg-slate-100 rounded-lg text-[11px] text-slate-700">
                                      {u.name}
                                      <button onClick={() => handleToggleFlagUser(flag.id, u.id)} className="p-0.5 text-slate-400 hover:text-red-500"><X size={10} /></button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="relative" ref={flagUserPickerFor === flag.id ? flagUserPickerRef : null}>
                                <button
                                  onClick={() => { setFlagUserPickerFor(flagUserPickerFor === flag.id ? null : flag.id); setFlagUserPickerSearch(""); }}
                                  className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1"
                                >
                                  <Plus size={12} />
                                  Añadir usuario
                                </button>
                                {flagUserPickerFor === flag.id && (
                                  <div className="absolute left-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-2">
                                    <input
                                      autoFocus
                                      value={flagUserPickerSearch}
                                      onChange={(e) => setFlagUserPickerSearch(e.target.value)}
                                      placeholder="Buscar usuario"
                                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs mb-1.5 focus:outline-none focus:ring-2 focus:ring-slate-900"
                                    />
                                    <div className="max-h-40 overflow-y-auto">
                                      {pickerUsers.map((u) => (
                                        <button
                                          key={u.id}
                                          onClick={() => { handleToggleFlagUser(flag.id, u.id); setFlagUserPickerSearch(""); }}
                                          className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-700"
                                        >
                                          {u.name}
                                        </button>
                                      ))}
                                      {pickerUsers.length === 0 && <p className="text-[11px] text-slate-400 text-center py-2">Sin resultados</p>}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
          </main>
        </div>
      </div>

      {/* ==================== MODALS ==================== */}

      {/* Create/Edit Project Modal */}
      {(showCreateProject || showEditProject) && (() => {
        const isEdit = !!showEditProject;
        const phase = phaseConfig[newProject.phase] || phaseConfig["Desarrollo"];
        const LANGUAGES = [
          { code: "es", flag: "🇪🇸", label: "Español", available: true },
          { code: "en", flag: "🇬🇧", label: "English",  available: false },
          { code: "fr", flag: "🇫🇷", label: "Français", available: false },
          { code: "de", flag: "🇩🇪", label: "Deutsch",  available: false },
          { code: "pt", flag: "🇵🇹", label: "Português", available: false },
        ];
        const closeModal = () => {
          setShowCreateProject(false);
          setShowEditProject(null);
          setNewProject({ name: "", description: "", phase: "Desarrollo", producers: [], customId: "", useCustomId: false, language: "es" });
          setProducerModalSearch("");
        };
        return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">

            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center">
                  <FolderPlus size={16} className="text-slate-700" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{isEdit ? "Editar proyecto" : "Nuevo proyecto"}</h3>
                </div>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            {/* Body — two columns */}
            <div className="flex-1 flex overflow-hidden">

              {/* ── Left: form ── */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">

                {/* Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Nombre del proyecto *</label>
                  <input
                    type="text"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    placeholder="Nombre del proyecto"
                    autoFocus
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>

                {/* Custom ID — creation only */}
                {!isEdit && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ID del proyecto</label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{newProject.useCustomId ? "Personalizado" : "Automático"}</span>
                        <button
                          type="button"
                          onClick={() => setNewProject({ ...newProject, useCustomId: !newProject.useCustomId, customId: "" })}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${newProject.useCustomId ? "bg-slate-900" : "bg-slate-200"}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${newProject.useCustomId ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
                        </button>
                      </div>
                    </div>
                    {newProject.useCustomId ? (
                      <div>
                        <input
                          type="text"
                          value={newProject.customId}
                          onChange={(e) => setNewProject({ ...newProject, customId: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })}
                          placeholder="nombre-del-proyecto"
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm font-mono"
                        />
                        {newProject.customId && (
                          <p className="mt-1.5 text-xs text-slate-400">
                            URL: <span className="font-mono text-slate-600">/project/{newProject.customId}</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                        <Hash size={13} className="text-slate-400" />
                        <p className="text-xs text-slate-500">Se generará un código de 6 caracteres automáticamente</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Descripción</label>
                  <textarea
                    value={newProject.description}
                    onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                    placeholder="Sinopsis o notas del proyecto"
                    rows={3}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                  />
                </div>

                {/* Phase */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Fase de producción</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PHASES.map((p) => {
                      const cfg = phaseConfig[p];
                      return (
                        <button
                          key={p}
                          onClick={() => setNewProject({ ...newProject, phase: p })}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                            newProject.phase === p ? `${cfg.bg} ${cfg.text} ${cfg.border}` : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Language */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Idioma de la plataforma</label>
                  <div className="grid grid-cols-5 gap-2">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        type="button"
                        disabled={!lang.available}
                        onClick={() => lang.available && setNewProject({ ...newProject, language: lang.code })}
                        className={`relative flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl border text-xs font-medium transition-all
                          ${!lang.available ? "opacity-40 cursor-not-allowed border-slate-100 bg-slate-50" :
                            newProject.language === lang.code
                              ? "bg-slate-900 border-slate-900 text-white"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                      >
                        <span className="text-xl leading-none">{lang.flag}</span>
                        <span className="text-[10px]">{lang.label}</span>
                        {!lang.available && (
                          <span className="absolute -top-1.5 -right-1 text-[8px] bg-slate-300 text-slate-600 px-1 py-0.5 rounded font-semibold leading-none">
                            Soon
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Producers */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Productoras</label>
                  {newProject.producers.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {newProject.producers.map((prodId) => {
                        const prod = producers.find((p) => p.id === prodId);
                        if (!prod) return null;
                        return (
                          <span key={prodId} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium">
                            <Building2 size={11} />
                            {prod.name}
                            <button onClick={() => setNewProject({ ...newProject, producers: newProject.producers.filter((id) => id !== prodId) })} className="hover:text-slate-300 ml-0.5">
                              <X size={11} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={producerModalSearch}
                      onChange={(e) => setProducerModalSearch(e.target.value)}
                      placeholder="Buscar y añadir productora"
                      className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none text-sm"
                    />
                  </div>
                  {producerModalSearch.length >= 1 && (
                    <div className="mt-2 border border-slate-200 rounded-xl max-h-36 overflow-y-auto">
                      {producers.filter((p) => p.name.toLowerCase().includes(producerModalSearch.toLowerCase()) && !newProject.producers.includes(p.id)).slice(0, 6).map((producer) => (
                        <button
                          key={producer.id}
                          onClick={() => { setNewProject({ ...newProject, producers: [...newProject.producers, producer.id] }); setProducerModalSearch(""); }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 flex items-center gap-2 border-b border-slate-100 last:border-b-0"
                        >
                          <Building2 size={13} className="text-slate-400" />
                          <span className="text-slate-700 flex-1">{producer.name}</span>
                          <span className="text-xs text-slate-400">{producer.projectCount} proyectos</span>
                        </button>
                      ))}
                      {producers.filter((p) => p.name.toLowerCase().includes(producerModalSearch.toLowerCase()) && !newProject.producers.includes(p.id)).length === 0 && (
                        <div className="px-4 py-3 text-xs text-slate-500 text-center">Sin resultados</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right: summary card ── */}
              <div className="w-64 flex-shrink-0 bg-slate-50 border-l border-slate-100 p-5 flex flex-col gap-4 overflow-y-auto">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Vista previa</p>

                {/* Project card preview */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg ${phase.bg} ${phase.text}`}>
                      {newProject.phase}
                    </span>
                    {newProject.language && (
                      <span className="text-xs">{LANGUAGES.find(l => l.code === newProject.language)?.flag}</span>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">
                      {newProject.name || <span className="text-slate-300 font-normal">Nombre del proyecto</span>}
                    </p>
                    {newProject.description && (
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">{newProject.description}</p>
                    )}
                  </div>
                  {newProject.producers.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {newProject.producers.map((pid) => {
                        const prod = producers.find(p => p.id === pid);
                        return prod ? (
                          <span key={pid} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">{prod.name}</span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>

                {/* Config summary */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 border-b border-slate-200">
                    <span className="text-xs text-slate-500">ID</span>
                    <span className="text-xs font-mono text-slate-700">
                      {newProject.useCustomId && newProject.customId ? newProject.customId : "auto"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-200">
                    <span className="text-xs text-slate-500">Idioma</span>
                    <span className="text-xs text-slate-700">
                      {LANGUAGES.find(l => l.code === newProject.language)?.flag}{" "}
                      {LANGUAGES.find(l => l.code === newProject.language)?.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-200">
                    <span className="text-xs text-slate-500">Productoras</span>
                    <span className="text-xs text-slate-700">{newProject.producers.length || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-xs text-slate-500">Departamentos</span>
                    <span className="text-xs text-slate-700">{DEFAULT_DEPARTMENTS.length} por defecto</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0 flex gap-3">
              <button onClick={closeModal} className="px-5 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={isEdit ? handleEditProject : handleCreateProject}
                disabled={saving || !newProject.name.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FolderPlus size={14} />
                {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear proyecto"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Create/Edit Producer Modal */}
      {(showCreateProducer || showEditProducer) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                  <Building2 size={20} className="text-amber-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {showEditProducer ? "Editar productora" : "Nueva productora"}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowCreateProducer(false);
                  setShowEditProducer(null);
                  setNewProducer({ name: "" });
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre de la productora *</label>
                <input
                  type="text"
                  value={newProducer.name}
                  onChange={(e) => setNewProducer({ ...newProducer, name: e.target.value })}
                  placeholder="Productora Films S.L."
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>
              <button
                onClick={showEditProducer ? handleEditProducer : handleCreateProducer}
                disabled={saving || !newProducer.name.trim()}
                className="w-full px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving ? "Guardando..." : showEditProducer ? "Guardar cambios" : "Crear productora"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Company User Modal */}
      {showAssignCompanyUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <Building2 size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Añadir usuario de productora</h3>
                  <p className="text-xs text-slate-500">
                    {producers.find((p) => p.id === showAssignCompanyUser)?.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAssignCompanyUser(null);
                  setCompanyUserSearch("");
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-500 mb-4">
                Este usuario podrá acceder al panel de la productora y ver todos sus proyectos.
              </p>
              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar usuario"
                  value={companyUserSearch}
                  onChange={(e) => setCompanyUserSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {users
                  .filter((u) => {
                    // Exclude users already assigned to any company
                    const userData = u;
                    const hasCompany = producers.some((p) => p.users?.some((pu) => pu.id === u.id));
                    if (hasCompany) return false;
                    // Filter by search
                    if (!companyUserSearch) return true;
                    return (
                      u.name.toLowerCase().includes(companyUserSearch.toLowerCase()) ||
                      u.email.toLowerCase().includes(companyUserSearch.toLowerCase())
                    );
                  })
                  .map((user) => (
                    <button
                      key={user.id}
                      onClick={() => handleAssignCompanyUser(user.id, showAssignCompanyUser)}
                      disabled={saving}
                      className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-xl text-left transition-colors disabled:opacity-50"
                    >
                      <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600 text-sm font-medium">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
                        <p className="text-xs text-slate-500 truncate">{user.email}</p>
                      </div>
                    </button>
                  ))}
                {users.filter((u) => !producers.some((p) => p.users?.some((pu) => pu.id === u.id))).length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-4">No hay usuarios disponibles</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User Details Modal */}
      {showUserDetails &&
        (() => {
          const user = users.find((u) => u.id === showUserDetails);
          if (!user) return null;
          return (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">Detalles del usuario</h3>
                  <button
                    onClick={() => setShowUserDetails(null)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  {/* User Header */}
                  <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-200">
                    <div className="w-16 h-16 bg-gradient-to-br from-slate-200 to-slate-300 rounded-2xl flex items-center justify-center text-slate-600 text-2xl font-semibold">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xl font-semibold text-slate-900">{user.name}</h4>
                        {user.role === "admin" && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-lg text-xs font-semibold">
                            <Crown size={10} />
                            Admin
                          </span>
                        )}
                        {user.role === "support_agent" && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold">
                            <HeadphonesIcon size={10} />
                            Agente · {SPECIALTY_LABEL[user.supportSpecialty || "both"]}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mt-1">{user.email}</p>
                    </div>
                  </div>

                  {/* Budgeting access */}
                  <div className="flex items-center justify-between gap-3 mb-6 pb-6 border-b border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#A855F71a" }}>
                        <Calculator size={15} style={{ color: "#A855F7" }} />
                      </div>
                      <p className="text-sm font-medium text-slate-900">Acceso a Budgeting</p>
                    </div>
                    <button
                      onClick={() => handleToggleBudgetingAccess(user.id, !user.budgetingAccess)}
                      disabled={saving}
                      className="w-10 h-6 rounded-full transition-colors relative flex-shrink-0 disabled:opacity-50"
                      style={{ background: user.budgetingAccess ? "#A855F7" : "#e2e8f0" }}
                    >
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${user.budgetingAccess ? "left-5" : "left-1"}`} />
                    </button>
                  </div>

                  {/* Projects */}
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-3">
                      Proyectos asignados ({user.projectCount})
                    </p>
                    {user.projects && user.projects.length > 0 ? (
                      <div className="space-y-2">
                        {user.projects.map((project) => (
                          <div
                            key={project.id}
                            className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                                <Briefcase size={14} className="text-blue-600" />
                              </div>
                              <span className="font-medium text-slate-900">{project.name}</span>
                            </div>
                            <span className="px-2.5 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-medium">
                              {project.role || project.position}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
                        <FolderOpen size={24} className="text-slate-300 mx-auto mb-2" />
                        <p className="text-sm text-slate-500">Sin proyectos asignados</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
                  <button
                    onClick={() => setShowUserDetails(null)}
                    className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                  >
                    Cerrar
                  </button>
                  <Link
                    href={`/admindashboard/users/${user.id}`}
                    className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                  >
                    <Eye size={14} />
                    Ver como
                  </Link>
                  <button
                    onClick={() => { setShowUserDetails(null); handleDeleteUser(user.id); }}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    Eliminar usuario
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Send Message Modal */}
      {showMessageModal && (() => {
        const canSend = messageForm.content.trim() &&
          (messageForm.recipientMode === "all" ||
          (messageForm.recipientMode === "projects" && messageForm.selectedProjects.length > 0) ||
          (messageForm.recipientMode === "users" && messageForm.selectedUsers.length > 0) ||
          (messageForm.recipientMode === "segment" && !!messageForm.selectedSegment));

        return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">

            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center">
                  <MessageSquare size={16} className="text-slate-700" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Nuevo mensaje</h3>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowMessageModal(false);
                  setEmailConfirmStep(false);
                  setMessageForm({ content: "", recipientMode: "all", selectedProjects: [], selectedUsers: [], selectedSegment: null, duration: "indefinite", sendByEmail: false });
                  setProjectSearchInMessage("");
                  setUserSearchInMessage("");
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body — two columns */}
            <div className="flex-1 flex overflow-hidden">

              {/* ── Left: compose ── */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5 border-r border-slate-100">

                {/* Content */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Mensaje *</label>
                  <textarea
                    value={messageForm.content}
                    onChange={(e) => setMessageForm({ ...messageForm, content: e.target.value })}
                    placeholder="Escribe el contenido del mensaje"
                    rows={4}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                  />
                </div>

                {/* Recipients */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Destinatarios</label>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {[
                      { mode: "all", label: "Todos", sublabel: `${users.length} usuarios`, icon: Users },
                      { mode: "projects", label: "Por proyecto", sublabel: "Uno o varios", icon: Briefcase },
                      { mode: "users", label: "Usuarios", sublabel: "Específicos", icon: UserPlus },
                      { mode: "segment", label: "Segmento", sublabel: "Guardado", icon: Activity },
                    ].map((opt) => {
                      const Icon = opt.icon;
                      const active = messageForm.recipientMode === opt.mode;
                      return (
                        <button
                          key={opt.mode}
                          onClick={() => setMessageForm({ ...messageForm, recipientMode: opt.mode as typeof messageForm.recipientMode, selectedProjects: [], selectedUsers: [], selectedSegment: null })}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${active ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                        >
                          <Icon size={16} className={active ? "text-white" : "text-slate-400"} />
                          <span className="text-xs font-semibold">{opt.label}</span>
                          <span className={`text-[10px] ${active ? "text-slate-300" : "text-slate-400"}`}>{opt.sublabel}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Project picker */}
                  {messageForm.recipientMode === "segment" && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                      {SEGMENT_PRESETS.map((seg) => {
                        const active = messageForm.selectedSegment === seg.id;
                        return (
                          <button
                            key={seg.id}
                            onClick={() => setMessageForm({ ...messageForm, selectedSegment: seg.id })}
                            disabled={seg.userIds.length === 0}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${active ? "bg-slate-900 text-white" : "bg-white border border-slate-200 hover:bg-slate-100 text-slate-700"}`}
                          >
                            <div>
                              <p className="text-xs font-semibold">{seg.label}</p>
                              <p className={`text-[10px] ${active ? "text-slate-300" : "text-slate-400"}`}>{seg.sub}</p>
                            </div>
                            {active ? <CheckSquare size={14} /> : <Square size={14} className="text-slate-300 flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {messageForm.recipientMode === "projects" && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={projectSearchInMessage}
                          onChange={(e) => setProjectSearchInMessage(e.target.value)}
                          placeholder="Buscar proyecto"
                          className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none text-xs"
                        />
                      </div>
                      {messageForm.selectedProjects.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {messageForm.selectedProjects.map((pid) => {
                            const p = projects.find((x) => x.id === pid);
                            return p ? (
                              <span key={pid} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-900 text-white rounded-lg text-xs">
                                {p.name}
                                <button onClick={() => toggleProjectInMessage(pid)} className="hover:text-slate-300"><X size={10} /></button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                      <div className="max-h-36 overflow-y-auto space-y-0.5">
                        {filteredProjectsForMessage.map((p) => {
                          const sel = messageForm.selectedProjects.includes(p.id);
                          return (
                            <button
                              key={p.id}
                              onClick={() => toggleProjectInMessage(p.id)}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors ${sel ? "bg-slate-900 text-white" : "hover:bg-slate-100 text-slate-700"}`}
                            >
                              {sel ? <CheckSquare size={12} /> : <Square size={12} className="text-slate-400" />}
                              <span className="flex-1 truncate font-medium">{p.name}</span>
                              <span className={sel ? "text-slate-300" : "text-slate-400"}>{p.memberCount}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* User picker */}
                  {messageForm.recipientMode === "users" && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={userSearchInMessage}
                          onChange={(e) => setUserSearchInMessage(e.target.value)}
                          placeholder="Buscar usuario"
                          className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none text-xs"
                        />
                      </div>
                      {messageForm.selectedUsers.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {messageForm.selectedUsers.map((uid) => {
                            const u = users.find((x) => x.id === uid);
                            return u ? (
                              <span key={uid} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-900 text-white rounded-lg text-xs">
                                {u.name}
                                <button onClick={() => toggleUserInMessage(uid)} className="hover:text-slate-300"><X size={10} /></button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                      <div className="max-h-36 overflow-y-auto space-y-0.5">
                        {filteredUsersForMessage.map((u) => {
                          const sel = messageForm.selectedUsers.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              onClick={() => toggleUserInMessage(u.id)}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors ${sel ? "bg-slate-900 text-white" : "hover:bg-slate-100 text-slate-700"}`}
                            >
                              {sel ? <CheckSquare size={12} /> : <Square size={12} className="text-slate-400" />}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{u.name}</p>
                                <p className={`truncate ${sel ? "text-slate-300" : "text-slate-400"}`}>{u.email}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Visibilidad</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { value: "24h", label: "24h" },
                      { value: "7d", label: "7 días" },
                      { value: "30d", label: "30 días" },
                      { value: "indefinite", label: "Siempre" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setMessageForm({ ...messageForm, duration: opt.value as typeof messageForm.duration })}
                        className={`py-2 rounded-xl border text-xs font-medium transition-all ${
                          messageForm.duration === opt.value ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    {messageForm.duration === "indefinite" ? "El mensaje no expira automáticamente" : `Se elimina automáticamente tras ${messageForm.duration === "24h" ? "24 horas" : messageForm.duration === "7d" ? "7 días" : "30 días"}`}
                  </p>
                </div>

                {/* Email toggle */}
                <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${messageForm.sendByEmail ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-center gap-3">
                    <Mail size={15} className={messageForm.sendByEmail ? "text-amber-600" : "text-slate-400"} />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Enviar por email</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setMessageForm({ ...messageForm, sendByEmail: !messageForm.sendByEmail }); setEmailConfirmStep(false); }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${messageForm.sendByEmail ? "bg-amber-500" : "bg-slate-200"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${messageForm.sendByEmail ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              </div>

              {/* ── Right: preview ── */}
              <div className="w-72 flex-shrink-0 bg-slate-50 p-5 flex flex-col gap-4 overflow-y-auto">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Vista previa</p>

                {/* Notification bell preview */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
                    <Bell size={12} className="text-slate-400" />
                    <span className="text-[10px] text-slate-400 font-medium">Notificación en plataforma</span>
                  </div>
                  <div className="p-3 flex gap-2.5">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: "#EFF2FF" }}
                    >
                      <Info size={14} style={{ color: "#2F52E0" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-700 leading-relaxed line-clamp-4">
                        {messageForm.content || "El mensaje aparecerá aquí..."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Recipient summary */}
                <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Alcance</p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
                      <Users size={14} className="text-white" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900 leading-none">{recipientCount}</p>
                      <p className="text-[11px] text-slate-500">destinatario{recipientCount !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                  {messageForm.recipientMode === "projects" && messageForm.selectedProjects.length > 0 && (
                    <p className="text-[11px] text-slate-400">De {messageForm.selectedProjects.length} proyecto{messageForm.selectedProjects.length !== 1 ? "s" : ""}</p>
                  )}
                  {messageForm.recipientMode === "segment" && messageForm.selectedSegment && (
                    <p className="text-[11px] text-slate-400">Segmento "{SEGMENT_PRESETS.find((s) => s.id === messageForm.selectedSegment)?.label}"</p>
                  )}
                  {messageForm.sendByEmail && (
                    <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
                      <Mail size={11} className="text-amber-500" />
                      <p className="text-[11px] text-amber-600 font-medium">+ email a cada destinatario</p>
                    </div>
                  )}
                </div>

                {/* Duration badge */}
                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl">
                  <Clock size={12} className="text-slate-400" />
                  <span className="text-xs text-slate-600">
                    {messageForm.duration === "indefinite" ? "Sin expiración" : `Expira en ${messageForm.duration === "24h" ? "24 h" : messageForm.duration === "7d" ? "7 días" : "30 días"}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            {emailConfirmStep ? (
              <div className="px-6 py-4 border-t border-amber-200 bg-amber-50 flex-shrink-0 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">¿Confirmas el envío por email?</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Se enviarán {recipientCount} email{recipientCount !== 1 ? "s" : ""} individuales. Esta acción no se puede deshacer.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setEmailConfirmStep(false)} className="flex-1 px-4 py-2.5 border border-amber-300 bg-white text-amber-800 rounded-xl text-sm font-medium hover:bg-amber-50">
                    Volver
                  </button>
                  <button
                    onClick={handleSendMessage}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                  >
                    <Send size={14} />
                    {saving ? "Enviando..." : "Confirmar y enviar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0 flex gap-3">
                <button
                  onClick={() => {
                    setShowMessageModal(false);
                    setEmailConfirmStep(false);
                    setMessageForm({ content: "", recipientMode: "all", selectedProjects: [], selectedUsers: [], selectedSegment: null, duration: "indefinite", sendByEmail: false });
                    setProjectSearchInMessage("");
                    setUserSearchInMessage("");
                  }}
                  className="px-5 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => messageForm.sendByEmail ? setEmailConfirmStep(true) : handleSendMessage()}
                  disabled={saving || !canSend}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send size={14} />
                  {saving ? "Enviando..." : `Enviar a ${recipientCount} usuario${recipientCount !== 1 ? "s" : ""}${messageForm.sendByEmail ? " + email" : ""}`}
                </button>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* Automated Messages Modal */}
      {showAutomatedMessagesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center">
                  <Settings size={16} className="text-slate-700" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Mensajes automáticos</h3>
                  <p className="text-xs text-slate-500">Se envían solos al abrirse un ticket. Usa <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">{"{{nombre}}"}</code> para el nombre del visitante.</p>
                </div>
              </div>
              <button onClick={() => setShowAutomatedMessagesModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            {automatedMessagesLoading ? (
              <div className="flex-1 flex items-center justify-center py-16">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Bienvenida · Ventas</label>
                  <textarea
                    value={automatedMessagesForm.welcomeSales}
                    onChange={(e) => setAutomatedMessagesForm({ ...automatedMessagesForm, welcomeSales: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Ticket de ventas: chat de la home y widget cuando el usuario dice ser productora interesada.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Bienvenida · Soporte técnico</label>
                  <textarea
                    value={automatedMessagesForm.welcomeTechnical}
                    onChange={(e) => setAutomatedMessagesForm({ ...automatedMessagesForm, welcomeTechnical: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Widget de soporte dentro de la app, para el resto de casos.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Aviso de respuesta lenta</label>
                  <textarea
                    value={automatedMessagesForm.slowResponse}
                    onChange={(e) => setAutomatedMessagesForm({ ...automatedMessagesForm, slowResponse: e.target.value })}
                    rows={2}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Aparece en el chat de la home si nadie responde en 3 minutos.</p>
                </div>

                <div className="pt-1 border-t border-slate-100">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 pt-4">Respuestas rápidas</label>
                  <p className="text-[11px] text-slate-400 mb-3">No se envían solas: aparecen como atajo al responder un ticket, para lo que se repite.</p>
                  <div className="space-y-2">
                    {automatedMessagesForm.macros.map((macro, i) => (
                      <div key={macro.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            value={macro.label}
                            onChange={(e) => {
                              const macros = [...automatedMessagesForm.macros];
                              macros[i] = { ...macro, label: e.target.value };
                              setAutomatedMessagesForm({ ...automatedMessagesForm, macros });
                            }}
                            placeholder="Nombre corto"
                            className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-slate-900 outline-none"
                          />
                          <button
                            onClick={() => setAutomatedMessagesForm({ ...automatedMessagesForm, macros: automatedMessagesForm.macros.filter((m) => m.id !== macro.id) })}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <textarea
                          value={macro.text}
                          onChange={(e) => {
                            const macros = [...automatedMessagesForm.macros];
                            macros[i] = { ...macro, text: e.target.value };
                            setAutomatedMessagesForm({ ...automatedMessagesForm, macros });
                          }}
                          rows={2}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-slate-900 outline-none resize-none"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setAutomatedMessagesForm({
                      ...automatedMessagesForm,
                      macros: [...automatedMessagesForm.macros, { id: `m${Date.now()}`, label: "", text: "" }],
                    })}
                    className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    <Plus size={13} />
                    Añadir respuesta rápida
                  </button>
                </div>
              </div>
            )}

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0 flex gap-3">
              <button onClick={() => setShowAutomatedMessagesModal(false)} className="px-5 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleSaveAutomatedMessages}
                disabled={automatedMessagesSaving || automatedMessagesLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                {automatedMessagesSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {automatedMessagesSaving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Maintenance Mode Modal */}
      {showMaintenanceModal && (() => {
        const startAtMs = maintenance.startAt ? maintenance.startAt.getTime() : null;
        const isActiveNow = maintenance.enabled && startAtMs !== null && Date.now() >= startAtMs;
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
                    <Wrench size={16} className="text-amber-700" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Modo mantenimiento</h3>
                    <p className="text-xs text-slate-500">Bloquea el acceso a todos menos a los admins</p>
                  </div>
                </div>
                <button onClick={() => setShowMaintenanceModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                  <X size={18} />
                </button>
              </div>

              {maintenance.enabled ? (
                <div className="p-6 space-y-4">
                  <div className={`p-4 rounded-xl border ${isActiveNow ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                    <p className={`text-sm font-medium ${isActiveNow ? "text-red-800" : "text-amber-800"}`}>
                      {isActiveNow ? "Mantenimiento activo ahora mismo" : "Mantenimiento programado"}
                    </p>
                    <p className={`text-xs mt-1 ${isActiveNow ? "text-red-600" : "text-amber-700"}`}>
                      {isActiveNow
                        ? "Los usuarios (excepto admins) están viendo la pantalla de mantenimiento."
                        : `Empieza a las ${maintenance.startAt?.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.`}
                    </p>
                    {maintenance.message && <p className="text-xs mt-2 italic text-slate-600">"{maintenance.message}"</p>}
                  </div>
                  <button
                    onClick={handleDeactivateMaintenance}
                    disabled={maintenanceSaving}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
                  >
                    {maintenanceSaving ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
                    {maintenanceSaving ? "Desactivando..." : "Desactivar mantenimiento"}
                  </button>
                </div>
              ) : (
                <div className="p-6 space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Empieza en</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "Ahora", value: 0 },
                        { label: "5 min", value: 5 },
                        { label: "10 min", value: 10 },
                        { label: "15 min", value: 15 },
                        { label: "30 min", value: 30 },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setMaintenanceMinutes(opt.value)}
                          className={`px-3 py-1.5 rounded-lg border text-sm font-medium ${
                            maintenanceMinutes === opt.value ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {maintenanceMinutes > 0 && (
                      <p className="text-xs text-slate-500 mt-2">
                        Durante esos {maintenanceMinutes} min todo el mundo verá un aviso para guardar cambios, sin bloquearles todavía.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Mensaje (opcional)</label>
                    <textarea
                      value={maintenanceMessage}
                      onChange={(e) => setMaintenanceMessage(e.target.value)}
                      rows={2}
                      placeholder="Volvemos en un rato con mejoras nuevas."
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                    />
                  </div>
                </div>
              )}

              {!maintenance.enabled && (
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
                  <button onClick={() => setShowMaintenanceModal(false)} className="px-5 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                    Cancelar
                  </button>
                  <button
                    onClick={handleActivateMaintenance}
                    disabled={maintenanceSaving}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    {maintenanceSaving ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />}
                    {maintenanceSaving ? "Activando..." : "Activar mantenimiento"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => setConfirmDialog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-500 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm text-white transition-colors ${confirmDialog.danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {confirmDialog.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Demo User Modal */}
      {showDemoModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Crear usuario demo</h2>
                <p className="text-xs text-slate-500 mt-0.5">Sin email real ni teléfono. Solo para pruebas.</p>
              </div>
              <button onClick={() => setShowDemoModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {!demoCreated ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Nombre</label>
                    <input
                      type="text"
                      placeholder="Ej: Usuario Demo 1"
                      value={demoForm.name}
                      onChange={(e) => setDemoForm({ ...demoForm, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Email (auto-generado)</label>
                    <input
                      type="text"
                      value={demoForm.email}
                      onChange={(e) => setDemoForm({ ...demoForm, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent font-mono text-slate-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Contraseña (auto-generada)</label>
                    <input
                      type="text"
                      value={demoForm.password}
                      onChange={(e) => setDemoForm({ ...demoForm, password: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent font-mono text-slate-600"
                    />
                  </div>
                  {demoError && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 rounded-xl">
                      <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                      <span className="text-xs text-red-600">{demoError}</span>
                    </div>
                  )}
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowDemoModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm">
                      Cancelar
                    </button>
                    <button
                      onClick={handleCreateDemoUser}
                      disabled={demoSaving}
                      className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-700 font-medium text-sm disabled:opacity-50"
                    >
                      {demoSaving ? "Creando..." : "Crear usuario"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl mb-2">
                    <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
                    <span className="text-sm text-green-700 font-medium">Usuario demo creado</span>
                  </div>
                  <div className="space-y-3 bg-slate-50 rounded-xl p-4">
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">Email</p>
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-sm text-slate-900 font-mono">{demoCreated.email}</code>
                        <button onClick={() => navigator.clipboard.writeText(demoCreated!.email)} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-200">
                          Copiar
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">Contraseña</p>
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-sm text-slate-900 font-mono">{demoCreated.password}</code>
                        <button onClick={() => navigator.clipboard.writeText(demoCreated!.password)} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-200">
                          Copiar
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowDemoModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm">
                      Cerrar
                    </button>
                    <button onClick={openDemoModal} className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-700 font-medium text-sm">
                      Crear otro
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Support Agent Modal */}
      {showCreateAgentModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <HeadphonesIcon size={16} className="text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Nuevo agente de soporte</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Solo tendrá acceso a la pestaña de Soporte.</p>
                </div>
              </div>
              <button onClick={() => setShowCreateAgentModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {!agentCreated ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Nombre</label>
                    <input
                      type="text"
                      placeholder="Ej: Ana García"
                      value={agentForm.name}
                      onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Email</label>
                    <input
                      type="text"
                      value={agentForm.email}
                      onChange={(e) => setAgentForm({ ...agentForm, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent font-mono text-slate-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Contraseña (auto-generada)</label>
                    <input
                      type="text"
                      value={agentForm.password}
                      onChange={(e) => setAgentForm({ ...agentForm, password: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent font-mono text-slate-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Especialidad</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["sales", "technical", "both"] as const).map((spec) => (
                        <button
                          key={spec}
                          type="button"
                          onClick={() => setAgentForm({ ...agentForm, specialty: spec })}
                          className={`px-2 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                            agentForm.specialty === spec
                              ? "bg-emerald-600 border-emerald-600 text-white"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {SPECIALTY_LABEL[spec]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {agentError && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 rounded-xl">
                      <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                      <span className="text-xs text-red-600">{agentError}</span>
                    </div>
                  )}
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowCreateAgentModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm">
                      Cancelar
                    </button>
                    <button
                      onClick={handleCreateSupportAgent}
                      disabled={agentSaving}
                      className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-medium text-sm disabled:opacity-50"
                    >
                      {agentSaving ? "Creando..." : "Crear agente"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl mb-2">
                    <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
                    <span className="text-sm text-green-700 font-medium">Agente creado</span>
                  </div>
                  <div className="space-y-3 bg-slate-50 rounded-xl p-4">
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">Email</p>
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-sm text-slate-900 font-mono">{agentCreated.email}</code>
                        <button onClick={() => navigator.clipboard.writeText(agentCreated!.email)} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-200">
                          Copiar
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">Contraseña</p>
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-sm text-slate-900 font-mono">{agentCreated.password}</code>
                        <button onClick={() => navigator.clipboard.writeText(agentCreated!.password)} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-200">
                          Copiar
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowCreateAgentModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm">
                      Cerrar
                    </button>
                    <button onClick={openCreateAgentModal} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-medium text-sm">
                      Crear otro
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
