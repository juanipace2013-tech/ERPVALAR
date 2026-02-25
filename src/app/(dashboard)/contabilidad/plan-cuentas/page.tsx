'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/utils';

interface ChartOfAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
  category: string | null;
  level: number;
  isDetailAccount: boolean;
  acceptsEntries: boolean;
  debitBalance: number;
  creditBalance: number;
  parentId: string | null;
  children?: ChartOfAccount[];
}

const typeColors: Record<string, string> = {
  ACTIVO: 'bg-blue-100 text-blue-800',
  PASIVO: 'bg-red-100 text-red-800',
  PATRIMONIO_NETO: 'bg-green-100 text-green-800',
  INGRESO: 'bg-emerald-100 text-emerald-800',
  EGRESO: 'bg-orange-100 text-orange-800',
};

const accountTypes = [
  { value: 'ACTIVO', label: 'Activo' },
  { value: 'PASIVO', label: 'Pasivo' },
  { value: 'PATRIMONIO_NETO', label: 'Patrimonio Neto' },
  { value: 'INGRESO', label: 'Ingreso' },
  { value: 'EGRESO', label: 'Egreso' },
];

interface AccountRowProps {
  account: ChartOfAccount;
  level: number;
  onToggle: (id: string) => void;
  onEdit: (account: ChartOfAccount) => void;
  onDelete: (account: ChartOfAccount) => void;
  expanded: Set<string>;
}

function AccountRow({ account, level = 0, onToggle, onEdit, onDelete, expanded }: AccountRowProps) {
  const hasChildren = (account.children?.length ?? 0) > 0;
  const isExpanded = expanded.has(account.id);

  return (
    <>
      <tr className="hover:bg-muted/50 border-b">
        <td className="p-3" style={{ paddingLeft: `${level * 24 + 12}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button onClick={() => onToggle(account.id)} className="p-1 hover:bg-muted rounded">
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : <div className="w-6" />}
            <span className={`font-mono ${level === 0 ? 'font-bold' : ''}`}>{account.code}</span>
          </div>
        </td>
        <td className="p-3">
          <div className="flex items-center gap-2">
            <span className={level === 0 ? 'font-bold' : ''}>{account.name}</span>
            {account.isDetailAccount && (
              <Badge variant="secondary" className="text-xs">Detalle</Badge>
            )}
          </div>
        </td>
        <td className="p-3">
          <Badge variant="outline" className={typeColors[account.accountType]}>
            {account.accountType}
          </Badge>
        </td>
        <td className="p-3 text-right font-mono">
          {account.isDetailAccount ? formatNumber(Number(account.debitBalance)) : '-'}
        </td>
        <td className="p-3 text-right font-mono">
          {account.isDetailAccount ? formatNumber(Number(account.creditBalance)) : '-'}
        </td>
        <td className="p-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => onEdit(account)}>
              <Pencil className="h-4 w-4" />
            </Button>
            {!hasChildren && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(account)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </td>
      </tr>
      {hasChildren && isExpanded && account.children?.map((child: ChartOfAccount) => (
        <AccountRow
          key={child.id}
          account={child}
          level={level + 1}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          expanded={expanded}
        />
      ))}
    </>
  );
}

export default function PlanDeCuentasPage() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expanded, setExpanded] = useState(new Set<string>());

  // Edit/Create dialog
  const [editDialog, setEditDialog] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ChartOfAccount | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    accountType: 'ACTIVO',
    category: '',
    isDetailAccount: false,
    acceptsEntries: true,
    parentId: null as string | null,
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const res = await fetch('/api/contabilidad/plan-cuentas');
      const data = await res.json();
      setAccounts(data);
      const level1 = data.map((acc: ChartOfAccount) => acc.id);
      setExpanded(new Set(level1));
    } catch (error) {
      toast.error('Error al cargar el plan de cuentas');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleEdit = (account: ChartOfAccount) => {
    setEditingAccount(account);
    setFormData({
      code: account.code,
      name: account.name,
      accountType: account.accountType,
      category: account.category || '',
      isDetailAccount: account.isDetailAccount,
      acceptsEntries: account.acceptsEntries,
      parentId: account.parentId,
    });
    setEditDialog(true);
  };

  const handleCreate = () => {
    setEditingAccount(null);
    setFormData({
      code: '',
      name: '',
      accountType: 'ACTIVO',
      category: '',
      isDetailAccount: false,
      acceptsEntries: true,
      parentId: null,
    });
    setEditDialog(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      if (editingAccount) {
        // Actualizar
        const res = await fetch(`/api/contabilidad/plan-cuentas/${editingAccount.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Error al actualizar cuenta');
        }
        toast.success('Cuenta actualizada correctamente');
      } else {
        // Crear
        const res = await fetch('/api/contabilidad/plan-cuentas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Error al crear cuenta');
        }
        toast.success('Cuenta creada correctamente');
      }

      setEditDialog(false);
      loadAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (account: ChartOfAccount) => {
    if (!confirm(`¿Está seguro de eliminar la cuenta ${account.code} - ${account.name}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/contabilidad/plan-cuentas/${account.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al eliminar cuenta');
      }

      toast.success('Cuenta eliminada correctamente');
      loadAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al eliminar');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const filtered = accounts.filter(acc =>
    acc.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    acc.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Plan de Cuentas</h1>
          <p className="text-muted-foreground">Gestión del plan de cuentas contable</p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva Cuenta
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Filtros</CardTitle></CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por código o nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 text-left font-semibold">Código</th>
                  <th className="p-3 text-left font-semibold">Nombre</th>
                  <th className="p-3 text-left font-semibold">Tipo</th>
                  <th className="p-3 text-right font-semibold">Debe</th>
                  <th className="p-3 text-right font-semibold">Haber</th>
                  <th className="p-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length > 0 ? (
                  filtered.map(account => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      level={0}
                      onToggle={toggleExpand}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      expanded={expanded}
                    />
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      No se encontraron cuentas
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit/Create Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? 'Editar Cuenta' : 'Nueva Cuenta'}
            </DialogTitle>
            <DialogDescription>
              {editingAccount
                ? 'Modifique los datos de la cuenta contable'
                : 'Complete los datos para crear una nueva cuenta'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Código *</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="1.1.01.001"
                  disabled={!!editingAccount}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="accountType">Tipo de Cuenta *</Label>
                <Select
                  value={formData.accountType}
                  onValueChange={(value) => setFormData({ ...formData, accountType: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accountTypes.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nombre de la cuenta"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Categoría (opcional)</Label>
              <Input
                id="category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="CAJA_Y_BANCOS, CREDITOS_VENTAS, etc."
              />
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isDetailAccount"
                  checked={formData.isDetailAccount}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, isDetailAccount: checked as boolean })
                  }
                />
                <Label htmlFor="isDetailAccount" className="font-normal">
                  Cuenta de detalle
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="acceptsEntries"
                  checked={formData.acceptsEntries}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, acceptsEntries: checked as boolean })
                  }
                />
                <Label htmlFor="acceptsEntries" className="font-normal">
                  Acepta asientos
                </Label>
              </div>
            </div>

            {!formData.isDetailAccount && !formData.acceptsEntries && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Cuenta de grupo</p>
                  <p>Esta cuenta no aceptará asientos directos, solo servirá para agrupar otras cuentas.</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !formData.code || !formData.name}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
