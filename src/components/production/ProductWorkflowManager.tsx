import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Save, Trash2, GitBranch, Package, Star } from 'lucide-react';
import { WorkflowDesigner, WorkflowNodeData } from './WorkflowDesigner';
import {
  useProductionProductsAdmin,
  useWorkflowTemplatesAdmin,
  useCreateWorkflowTemplateMutation,
  useUpdateWorkflowTemplateMutation,
  useSetWorkflowTemplateDefaultMutation,
  useDeleteWorkflowTemplateMutation,
  type WorkflowTemplate,
} from '@/hooks';
import type { Node, Edge } from '@xyflow/react';

export default function ProductWorkflowManager() {
  const { t } = useTranslation();
  const [selectedProduct, setSelectedProduct] = useState<string>('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WorkflowTemplate | null>(null);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateProductId, setNewTemplateProductId] = useState<string | null>(null);

  // Fetch products and templates using hooks
  const { data: products } = useProductionProductsAdmin();
  const { data: templates, isLoading } = useWorkflowTemplatesAdmin(selectedProduct === 'all' ? undefined : selectedProduct);

  // Mutation hooks
  const createMutationHook = useCreateWorkflowTemplateMutation();
  const saveWorkflowMutationHook = useUpdateWorkflowTemplateMutation();
  const setDefaultMutationHook = useSetWorkflowTemplateDefaultMutation();
  const deleteMutationHook = useDeleteWorkflowTemplateMutation();

  // Wrapper mutations with UI callbacks
  const createMutation = {
    mutate: (data: { name: string; product_id: string | null }) => {
      createMutationHook.mutate(data, {
        onSuccess: () => {
          setIsCreateOpen(false);
          setNewTemplateName('');
          setNewTemplateProductId(null);
          toast.success(t('admin.production.workflow.templateCreated'));
        },
        onError: () => toast.error(t('admin.production.workflow.errors.createFailed')),
      });
    },
    isPending: createMutationHook.isPending,
  };

  const saveWorkflowMutation = {
    mutate: ({ id, workflow_data, workflow_steps }: { 
      id: string; 
      workflow_data: { nodes: Node<WorkflowNodeData>[]; edges: Edge[] };
      workflow_steps: WorkflowTemplate['workflow_steps'];
    }) => {
      saveWorkflowMutationHook.mutate({ id, workflow_data, workflow_steps }, {
        onSuccess: () => toast.success(t('admin.production.workflow.workflowSaved')),
        onError: () => toast.error(t('admin.production.workflow.errors.saveFailed')),
      });
    },
    isPending: saveWorkflowMutationHook.isPending,
  };

  const setDefaultMutation = {
    mutate: ({ id, productId }: { id: string; productId: string | null }) => {
      setDefaultMutationHook.mutate({ id, productId }, {
        onSuccess: () => toast.success(t('admin.production.workflow.setAsDefault')),
        onError: () => toast.error(t('admin.production.workflow.errors.setDefaultFailed')),
      });
    },
    isPending: setDefaultMutationHook.isPending,
  };

  const deleteMutation = {
    mutate: (id: string) => {
      deleteMutationHook.mutate(id, {
        onSuccess: () => toast.success(t('admin.production.workflow.templateDeleted')),
        onError: () => toast.error(t('admin.production.workflow.errors.deleteFailed')),
      });
    },
    isPending: deleteMutationHook.isPending,
  };

  // Convert nodes to workflow steps
  const nodesToSteps = (nodes: Node<WorkflowNodeData>[]): WorkflowTemplate['workflow_steps'] => {
    return nodes
      .sort((a, b) => a.position.x - b.position.x)
      .map((node, index) => ({
        order: index + 1,
        name: node.data.label,
        type: node.data.type,
        expectedInput: node.data.inputVolume,
        expectedOutput: node.data.outputVolume,
        expectedLoss: node.data.loss,
      }));
  };

  const handleSaveWorkflow = (data: { nodes: Node<WorkflowNodeData>[]; edges: Edge[] }) => {
    if (!editingTemplate) return;
    
    const steps = nodesToSteps(data.nodes);
    saveWorkflowMutation.mutate({
      id: editingTemplate.id,
      workflow_data: data,
      workflow_steps: steps,
    });
  };

  if (editingTemplate) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{editingTemplate.name}</h2>
            {editingTemplate.product && (
              <Badge variant="outline" className="mt-1">
                <Package className="w-3 h-3 mr-1" />
                {editingTemplate.product.name}
              </Badge>
            )}
          </div>
          <Button variant="outline" onClick={() => setEditingTemplate(null)}>
            {t('common.back')}
          </Button>
        </div>
        
        <WorkflowDesigner
          batchId={editingTemplate.id}
          onSave={handleSaveWorkflow}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t('admin.production.workflow.productTemplates')}</h2>
          <p className="text-sm text-muted-foreground">{t('admin.production.workflow.productTemplatesDescription')}</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedProduct} onValueChange={setSelectedProduct}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t('admin.production.workflow.filterByProduct')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.all')}</SelectItem>
              {products?.map((product) => (
                <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t('admin.production.workflow.createTemplate')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : templates?.length === 0 ? (
            <div className="h-32 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <GitBranch className="w-8 h-8" />
              <p>{t('admin.production.workflow.noTemplates')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.production.workflow.templateName')}</TableHead>
                  <TableHead>{t('admin.production.workflow.product')}</TableHead>
                  <TableHead>{t('admin.production.workflow.steps')}</TableHead>
                  <TableHead>{t('admin.production.workflow.default')}</TableHead>
                  <TableHead>{t('admin.production.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates?.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell>
                      {template.product ? (
                        <Badge variant="outline">
                          <Package className="w-3 h-3 mr-1" />
                          {template.product.name}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {template.workflow_steps?.length || 0} {t('admin.production.workflow.stepsCount')}
                    </TableCell>
                    <TableCell>
                      {template.is_default && (
                        <Badge className="bg-amber-500">
                          <Star className="w-3 h-3 mr-1" />
                          {t('admin.production.workflow.defaultLabel')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => setEditingTemplate(template)}
                        >
                          <GitBranch className="w-4 h-4" />
                        </Button>
                        {!template.is_default && template.product_id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDefaultMutation.mutate({ 
                              id: template.id, 
                              productId: template.product_id 
                            })}
                          >
                            <Star className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(template.id)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Template Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.production.workflow.createTemplate')}</DialogTitle>
            <DialogDescription>{t('admin.production.workflow.createTemplateDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('admin.production.workflow.templateName')}</Label>
              <Input
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder={t('admin.production.workflow.templateNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.production.workflow.product')}</Label>
              <Select value={newTemplateProductId || ''} onValueChange={setNewTemplateProductId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('admin.production.workflow.selectProduct')} />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((product) => (
                    <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={() => createMutation.mutate({ 
                name: newTemplateName, 
                product_id: newTemplateProductId || '' 
              })}
              disabled={!newTemplateName || createMutation.isPending}
            >
              <Save className="w-4 h-4 mr-2" />
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
