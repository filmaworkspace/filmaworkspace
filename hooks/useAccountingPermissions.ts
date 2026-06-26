"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

// Roles de proyecto (tienen acceso a todo el proyecto)
const PROJECT_ROLES = ["EP", "PM", "Controller", "PC"];

// Posiciones de departamento
const DEPARTMENT_POSITIONS = ["HOD", "Coordinator", "Crew"];

// Niveles de acceso a contabilidad
type AccountingAccessLevel = "visitor" | "user" | "accounting" | "accounting_extended";

interface UserPermissions {
  // Info del usuario
  userId: string | null;
  userName: string;
  userEmail: string;
  
  // Rol en el proyecto
  role: string | null;           // EP, PM, Controller, PC, o null
  department: string | null;      // Departamento asignado (solo para roles de departamento)
  position: string | null;        // HOD, Coordinator, Crew (solo para roles de departamento)
  
  // Tipo de rol
  isProjectRole: boolean;         // true si es EP, PM, Controller, PC
  isDepartmentRole: boolean;      // true si es HOD, Coordinator, Crew
  
  // Nivel de acceso a accounting
  accountingAccessLevel: AccountingAccessLevel;
  hasAccountingAccess: boolean;
  
  // Permisos específicos de accounting
  canAccessPanel: boolean;
  canAccessSuppliers: boolean;
  canAccessBudget: boolean;
  canAccessUsers: boolean;
  canAccessReports: boolean;
  
  // Permisos para POs/Facturas
  canCreatePO: boolean;
  canViewAllPOs: boolean;         // Ver todas las POs del proyecto
  canViewDepartmentPOs: boolean;  // Ver POs de su departamento
  canViewOwnPOs: boolean;         // Ver solo sus propias POs
  canEditAllPOs: boolean;         // Editar cualquier PO
  canEditDepartmentPOs: boolean;  // Editar POs de su departamento
  canEditOwnPOs: boolean;         // Editar solo sus propias POs
  
  // Para el formulario de creación
  mustSelectDepartment: boolean;  // true si debe elegir departamento manualmente
  fixedDepartment: string | null; // Departamento fijo (para roles de departamento)
}

interface POPermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canCancel: boolean;
  canClose: boolean;
  canReopen: boolean;
  canCreateInvoice: boolean;
}

interface UseAccountingPermissionsReturn {
  // Estado
  loading: boolean;
  error: string | null;
  permissions: UserPermissions;
  
  // Funciones de utilidad
  canViewPO: (po: POData) => boolean;
  canEditPO: (po: POData) => boolean;
  getPOPermissions: (po: POData) => POPermissions;
  filterPOsByPermission: <T extends POData>(pos: T[]) => T[];
  getDepartmentForNewPO: () => string;
  getAvailableDepartments: (allDepartments: string[]) => string[];
}

interface POData {
  id: string;
  department?: string;
  createdBy: string;
  status: "draft" | "pending" | "approved" | "rejected" | "closed" | "cancelled";
  invoicedAmount?: number;
}

const DEFAULT_PERMISSIONS: UserPermissions = {
  userId: null,
  userName: "",
  userEmail: "",
  role: null,
  department: null,
  position: null,
  isProjectRole: false,
  isDepartmentRole: false,
  accountingAccessLevel: "visitor",
  hasAccountingAccess: false,
  canAccessPanel: false,
  canAccessSuppliers: false,
  canAccessBudget: false,
  canAccessUsers: false,
  canAccessReports: false,
  canCreatePO: false,
  canViewAllPOs: false,
  canViewDepartmentPOs: false,
  canViewOwnPOs: false,
  canEditAllPOs: false,
  canEditDepartmentPOs: false,
  canEditOwnPOs: false,
  mustSelectDepartment: false,
  fixedDepartment: null,
};

export function useAccountingPermissions(projectId: string | null): UseAccountingPermissionsReturn {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<UserPermissions>(DEFAULT_PERMISSIONS);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setPermissions(DEFAULT_PERMISSIONS);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const userId = user.uid;
        const userName = user.displayName || user.email || "Usuario";
        const userEmail = user.email || "";

        // 1. Verificar acceso al proyecto y permisos generales
        const userProjectRef = doc(db, `userProjects/${userId}/projects`, projectId);
        const userProjectSnap = await getDoc(userProjectRef);

        if (!userProjectSnap.exists()) {
          setError("No tienes acceso a este proyecto");
          setPermissions({ ...DEFAULT_PERMISSIONS, userId, userName, userEmail });
          setLoading(false);
          return;
        }

        const userProjectData = userProjectSnap.data();
        const hasAccountingPermission = userProjectData.permissions?.accounting || false;

        if (!hasAccountingPermission) {
          setError("No tienes permisos para acceder a contabilidad");
          setPermissions({ ...DEFAULT_PERMISSIONS, userId, userName, userEmail });
          setLoading(false);
          return;
        }

        // 2. Obtener datos del miembro en el proyecto
        const memberRef = doc(db, `projects/${projectId}/members`, userId);
        const memberSnap = await getDoc(memberRef);

        if (!memberSnap.exists()) {
          setError("No eres miembro de este proyecto");
          setPermissions({ ...DEFAULT_PERMISSIONS, userId, userName, userEmail, hasAccountingAccess: true });
          setLoading(false);
          return;
        }

        const memberData = memberSnap.data();
        const role = memberData.role || null;
        const department = memberData.department || null;
        const position = memberData.position || null;
        const accountingAccessLevel: AccountingAccessLevel = memberData.accountingAccessLevel || "user";

        // 3. Determinar tipo de rol
        const isProjectRole = role ? PROJECT_ROLES.includes(role) : false;
        const isDepartmentRole = position ? DEPARTMENT_POSITIONS.includes(position) : false;

        // 4. Calcular permisos de acceso a secciones de accounting
        const accessLevels = {
          visitor: { panel: true, suppliers: false, budget: false, users: false, reports: false },
          user: { panel: true, suppliers: true, budget: false, users: false, reports: false },
          accounting: { panel: true, suppliers: true, budget: false, users: false, reports: true },
          accounting_extended: { panel: true, suppliers: true, budget: true, users: true, reports: true },
        };
        const accessConfig = accessLevels[accountingAccessLevel] || accessLevels.visitor;

        // 5. Calcular permisos para POs
        let canViewAllPOs = false;
        let canViewDepartmentPOs = false;
        let canViewOwnPOs = false;
        let canEditAllPOs = false;
        let canEditDepartmentPOs = false;
        let canEditOwnPOs = false;
        let mustSelectDepartment = false;
        let fixedDepartment: string | null = null;

        if (isProjectRole) {
          // Roles de proyecto: acceso total
          canViewAllPOs = true;
          canEditAllPOs = true;
          mustSelectDepartment = true; // Deben elegir departamento manualmente
        } else if (isDepartmentRole && department) {
          // Roles de departamento
          fixedDepartment = department;
          
          if (position === "HOD" || position === "Coordinator") {
            // HOD y Coordinator: ven y editan todo su departamento
            canViewDepartmentPOs = true;
            canEditDepartmentPOs = true;
          } else if (position === "Crew") {
            // Crew: solo ven y editan sus propias POs
            canViewOwnPOs = true;
            canEditOwnPOs = true;
          }
        } else {
          // Usuario sin rol específico: solo sus propias POs
          canViewOwnPOs = true;
          canEditOwnPOs = true;
        }

        // Todos con acceso a accounting pueden crear POs
        const canCreatePO = hasAccountingPermission && accessConfig.suppliers;

        setPermissions({
          userId,
          userName,
          userEmail,
          role,
          department,
          position,
          isProjectRole,
          isDepartmentRole,
          accountingAccessLevel,
          hasAccountingAccess: hasAccountingPermission,
          canAccessPanel: accessConfig.panel,
          canAccessSuppliers: accessConfig.suppliers,
          canAccessBudget: accessConfig.budget,
          canAccessUsers: accessConfig.users,
          canAccessReports: accessConfig.reports,
          canCreatePO,
          canViewAllPOs,
          canViewDepartmentPOs,
          canViewOwnPOs,
          canEditAllPOs,
          canEditDepartmentPOs,
          canEditOwnPOs,
          mustSelectDepartment,
          fixedDepartment,
        });

        setLoading(false);
      } catch (err: any) {
        console.error("Error loading permissions:", err);
        setError(err.message || "Error al cargar permisos");
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [projectId]);

  // Función para verificar si puede ver una PO específica
  const canViewPO = useCallback((po: POData): boolean => {
    if (!permissions.hasAccountingAccess) return false;
    if (permissions.canViewAllPOs) return true;
    if (permissions.canViewDepartmentPOs && po.department === permissions.department) return true;
    if (permissions.canViewOwnPOs && po.createdBy === permissions.userId) return true;
    return false;
  }, [permissions]);

  // Función para verificar si puede editar una PO específica
  const canEditPO = useCallback((po: POData): boolean => {
    if (!permissions.hasAccountingAccess) return false;
    
    // Solo se pueden editar borradores y rechazadas
    if (po.status !== "draft" && po.status !== "rejected") return false;
    
    if (permissions.canEditAllPOs) return true;
    if (permissions.canEditDepartmentPOs && po.department === permissions.department) return true;
    if (permissions.canEditOwnPOs && po.createdBy === permissions.userId) return true;
    return false;
  }, [permissions]);

  // Función para obtener todos los permisos sobre una PO específica
  const getPOPermissions = useCallback((po: POData): POPermissions => {
    const canView = canViewPO(po);
    const canEdit = canEditPO(po);
    
    // Permisos de acciones especiales (solo para roles de proyecto o quien puede editar)
    const canPerformActions = permissions.isProjectRole || canEdit;
    const isOwnerOrProjectRole = permissions.isProjectRole || po.createdBy === permissions.userId;
    
    return {
      canView,
      canEdit,
      canDelete: canEdit && po.status === "draft",
      canApprove: false, // Se gestiona por el flujo de aprobación
      canCancel: canPerformActions && (po.status === "approved" || po.status === "draft") && (po.invoicedAmount || 0) === 0,
      canClose: canPerformActions && po.status === "approved",
      canReopen: canPerformActions && po.status === "closed",
      canCreateInvoice: canPerformActions && po.status === "approved",
    };
  }, [permissions, canViewPO, canEditPO]);

  // Función para filtrar POs según permisos
  const filterPOsByPermission = useCallback(<T extends POData>(pos: T[]): T[] => {
    if (!permissions.hasAccountingAccess) return [];
    if (permissions.canViewAllPOs) return pos;
    
    return pos.filter((po) => {
      if (permissions.canViewDepartmentPOs && po.department === permissions.department) return true;
      if (permissions.canViewOwnPOs && po.createdBy === permissions.userId) return true;
      return false;
    });
  }, [permissions]);

  // Función para obtener el departamento para una nueva PO
  const getDepartmentForNewPO = useCallback((): string => {
    if (permissions.fixedDepartment) return permissions.fixedDepartment;
    return "";
  }, [permissions]);

  // Función para obtener departamentos disponibles para seleccionar
  const getAvailableDepartments = useCallback((allDepartments: string[]): string[] => {
    if (permissions.mustSelectDepartment) return allDepartments;
    if (permissions.fixedDepartment) return [permissions.fixedDepartment];
    return allDepartments;
  }, [permissions]);

  return {
    loading,
    error,
    permissions,
    canViewPO,
    canEditPO,
    getPOPermissions,
    filterPOsByPermission,
    getDepartmentForNewPO,
    getAvailableDepartments,
  };
}

export type { UserPermissions, POPermissions, POData, AccountingAccessLevel };
export { PROJECT_ROLES, DEPARTMENT_POSITIONS };
