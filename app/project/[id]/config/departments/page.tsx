"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Button, EmptyState, Field, IconButton, Input, Menu, MenuItem, Modal,
  NoAccess, Page, PageHeader, PageLoading, Table, Td, Th, Tr, useToast,
} from "@/components/ds";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  onAuthStateChanged,
} from "firebase/auth";
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  MoreHorizontal,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface Member {
  userId: string;
  name: string;
  email: string;
  department?: string;
  position?: string;
}

interface DepartmentData {
  name: string;
  members: Member[];
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ConfigDepartments() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasConfigAccess, setHasConfigAccess] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [departmentsData, setDepartmentsData] = useState<DepartmentData[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDepartment, setNewDepartment] = useState("");
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [toastNode, showToast] = useToast();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/");
      else setUserId(u.uid);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!userId || !id) return;
    const loadData = async () => {
      try {
        const userProjectSnap = await getDoc(doc(db, `userProjects/${userId}/projects/${id}`));
        if (!userProjectSnap.exists()) { setLoading(false); return; }
        const hasConfig = userProjectSnap.data().permissions?.config || false;
        setHasConfigAccess(hasConfig);
        if (!hasConfig) { setLoading(false); return; }
        const projectSnap = await getDoc(doc(db, "projects", id as string));
        if (projectSnap.exists()) {
          setProjectName(projectSnap.data().name);
          setDepartments(projectSnap.data().departments || []);
        }
        const membersSnap = await getDocs(collection(db, `projects/${id}/members`));
        setMembers(membersSnap.docs.map((d) => ({ userId: d.id, name: d.data().name, email: d.data().email, department: d.data().department, position: d.data().position })));
        setLoading(false);
      } catch { showToast("error", "Error al cargar"); setLoading(false); }
    };
    loadData();
  }, [userId, id, router]);

  useEffect(() => {
    const data: DepartmentData[] = departments.map((d) => ({ name: d, members: members.filter((m) => m.department === d) })).sort((a, b) => a.name.localeCompare(b.name));
    setDepartmentsData(data);
  }, [departments, members]);

  const handleAddDepartment = async () => {
    if (!id || !newDepartment.trim()) return;
    if (departments.includes(newDepartment.trim())) { showToast("error", "Ya existe este departamento"); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", id as string), { departments: arrayUnion(newDepartment.trim()) });
      setDepartments([...departments, newDepartment.trim()]);
      setNewDepartment("");
      setShowAddForm(false);
      showToast("success", "Departamento creado");
    } catch { showToast("error", "Error al crear"); } finally { setSaving(false); }
  };

  const handleRemoveDepartment = async (dept: string) => {
    const usersIn = members.filter((m) => m.department === dept);
    if (usersIn.length > 0) { showToast("error", `No se puede eliminar: tiene ${usersIn.length} miembro${usersIn.length !== 1 ? "s" : ""}`); setConfirmDelete(null); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", id as string), { departments: arrayRemove(dept) });
      setDepartments(departments.filter((d) => d !== dept));
      showToast("success", "Departamento eliminado");
    } catch { showToast("error", "Error"); } finally { setSaving(false); setConfirmDelete(null); setActiveMenu(null); }
  };

  if (loading) return <PageLoading />;
  if (!hasConfigAccess) return <NoAccess />;

  const unassigned = members.filter((m) => m.department && !departments.includes(m.department)).length;

  return (
    <Page>
      {toastNode}

      <PageHeader
        title="Departamentos"
        meta={`${departments.length} ${departments.length === 1 ? "departamento" : "departamentos"}`}
        actions={<Button variant="primary" onClick={() => setShowAddForm(true)}>Nuevo departamento</Button>}
      />

      <div className="mt-6">
        {departmentsData.length === 0 ? (
          <EmptyState
            title="Aún no hay departamentos"
            action={<Button size="sm" onClick={() => setShowAddForm(true)}>Crear el primero</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr><Th>Departamento</Th><Th align="right" className="w-24">Miembros</Th><Th>Personas</Th><Th className="w-10" /></tr>
            </thead>
            <tbody>
              {departmentsData.map((dept) => (
                <Tr key={dept.name}>
                  <Td className="font-medium text-slate-900">{dept.name}</Td>
                  <Td align="right" className="tabular-nums">{dept.members.length}</Td>
                  <Td className="max-w-0 w-full">
                    <p className="truncate text-slate-500">
                      {dept.members.length
                        ? dept.members.map((m) => (m.position ? `${m.name} (${m.position})` : m.name)).join(", ")
                        : <span className="text-slate-300">—</span>}
                    </p>
                  </Td>
                  <Td align="right">
                    <Menu trigger={(toggle) => <IconButton label="Acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
                      {(close) => (
                        <MenuItem danger onClick={() => { close(); setConfirmDelete(dept.name); }}>Eliminar</MenuItem>
                      )}
                    </Menu>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {unassigned > 0 && (
          <p className="mt-3 text-xs text-slate-400">
            {unassigned} {unassigned === 1 ? "miembro tiene" : "miembros tienen"} un departamento que ya no existe.
          </p>
        )}
      </div>

      {/* ── Nuevo ── */}
      <Modal
        open={showAddForm}
        onClose={() => { setShowAddForm(false); setNewDepartment(""); }}
        title="Nuevo departamento"
        width="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setShowAddForm(false); setNewDepartment(""); }}>Cancelar</Button>
            <Button variant="primary" loading={saving} disabled={!newDepartment.trim()} onClick={handleAddDepartment}>Crear</Button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); handleAddDepartment(); }}>
          <Field label="Nombre">
            <Input autoFocus value={newDepartment} onChange={(e) => setNewDepartment(e.target.value)} placeholder="Fotografía" />
          </Field>
        </form>
      </Modal>

      {/* ── Eliminar ── */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Eliminar departamento"
        width="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button variant="danger" loading={saving} onClick={() => confirmDelete && handleRemoveDepartment(confirmDelete)}>Eliminar</Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">
          Se eliminará <span className="font-medium text-slate-900">{confirmDelete}</span>. Solo se puede eliminar si no tiene miembros.
        </p>
      </Modal>
    </Page>
  );
}
