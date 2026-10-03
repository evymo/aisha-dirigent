import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { UserCheck, BookOpen, X, Plus, Shield } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  TrackingDocument,
  useDocumentSharingPermissions,
  useGrantDocumentSharing,
  useRevokeDocumentSharing,
} from '@/hooks/useTrackingDocuments';
import { useAvailablePartnersForSharing } from '@/hooks/useDataSharingConsent';
import { useMyRegistrations } from '@/hooks/useStudies';

interface DocumentSharingDialogProps {
  document: TrackingDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocumentSharingDialog({ document, open, onOpenChange }: DocumentSharingDialogProps) {
  const { t } = useTranslation();
  const { data: permissions } = useDocumentSharingPermissions(document.id);
  const { data: availablePartners } = useAvailablePartnersForSharing();
  const { registrations } = useMyRegistrations();
  const grantMutation = useGrantDocumentSharing();
  const revokeMutation = useRevokeDocumentSharing();

  const [showAddPermission, setShowAddPermission] = useState(false);
  const [newPermission, setNewPermission] = useState({
    type: 'partner' as 'partner' | 'study',
    targetId: '',
    canView: true,
    canUseForStatistics: false,
    canUseForResearch: false,
  });

  const handleGrant = async () => {
    if (!newPermission.targetId) return;

    await grantMutation.mutateAsync({
      documentId: document.id,
      partnerId: newPermission.type === 'partner' ? newPermission.targetId : undefined,
      studyId: newPermission.type === 'study' ? newPermission.targetId : undefined,
      canView: newPermission.canView,
      canUseForStatistics: newPermission.canUseForStatistics,
      canUseForResearch: newPermission.canUseForResearch,
    });

    setShowAddPermission(false);
    setNewPermission({
      type: 'partner',
      targetId: '',
      canView: true,
      canUseForStatistics: false,
      canUseForResearch: false,
    });
  };

  const handleRevoke = async (permissionId: string) => {
    await revokeMutation.mutateAsync({ permissionId, documentId: document.id });
  };

  const activeRegistrations = registrations?.filter(e => 
    e.status === 'enrolled' || e.status === 'active'
  ) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t('member.documents.sharing.title')}
          </DialogTitle>
          <DialogDescription>
            {t('member.documents.sharing.description')}
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription className="text-sm">
            {t('member.documents.sharing.consentNotice')}
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          {/* Document info */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="font-medium">{document.title || document.file_name}</p>
            <p className="text-sm text-muted-foreground">
              {t(`member.documents.categories.${document.category}`)}
            </p>
          </div>

          {/* Current permissions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">{t('member.documents.sharing.currentAccess')}</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddPermission(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                {t('member.documents.sharing.addAccess')}
              </Button>
            </div>

            <ScrollArea className="h-[200px]">
              {!permissions?.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t('member.documents.sharing.noSharing')}
                </p>
              ) : (
                <div className="space-y-2">
                  {permissions.map((perm) => (
                    <Card key={perm.id}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            {perm.shared_with_partner_id ? (
                              <UserCheck className="h-4 w-4 mt-0.5 text-muted-foreground" />
                            ) : (
                              <BookOpen className="h-4 w-4 mt-0.5 text-muted-foreground" />
                            )}
                            <div>
                              <p className="text-sm font-medium">
                                {perm.partner_profile?.display_name || 
                                 perm.study?.name || 
                                 t('member.documents.sharing.unknown')}
                              </p>
                              <div className="flex gap-1 flex-wrap mt-1">
                                {perm.can_view && (
                                  <Badge variant="secondary" className="text-xs">
                                    {t('member.documents.sharing.canView')}
                                  </Badge>
                                )}
                                {perm.can_use_for_statistics && (
                                  <Badge variant="secondary" className="text-xs">
                                    {t('member.documents.sharing.canUseStats')}
                                  </Badge>
                                )}
                                {perm.can_use_for_research && (
                                  <Badge variant="secondary" className="text-xs">
                                    {t('member.documents.sharing.canUseResearch')}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {t('member.documents.sharing.grantedAt')}: {format(new Date(perm.granted_at), 'PP')}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRevoke(perm.id)}
                            disabled={revokeMutation.isPending}
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Add new permission */}
          {showAddPermission && (
            <>
              <Separator />
              <div className="space-y-4">
                <h4 className="text-sm font-medium">{t('member.documents.sharing.grantNew')}</h4>
                
                <div className="space-y-3">
                  <div>
                    <Label>{t('member.documents.sharing.shareWith')}</Label>
                    <Select
                      value={newPermission.type}
                      onValueChange={(value) => setNewPermission(prev => ({ 
                        ...prev, 
                        type: value as 'partner' | 'study',
                        targetId: ''
                      }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="partner">
                          {t('member.documents.sharing.partner')}
                        </SelectItem>
                        <SelectItem value="study">
                          {t('member.documents.sharing.study')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>
                      {newPermission.type === 'partner' 
                        ? t('member.documents.sharing.selectPartner')
                        : t('member.documents.sharing.selectStudy')}
                    </Label>
                    <Select
                      value={newPermission.targetId}
                      onValueChange={(value) => setNewPermission(prev => ({ ...prev, targetId: value }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder={t('member.documents.sharing.select')} />
                      </SelectTrigger>
                      <SelectContent>
                        {newPermission.type === 'partner' ? (
                          availablePartners?.map(partner => (
                            <SelectItem key={partner.id} value={partner.id}>
                              {partner.display_name}
                              {partner.business_name && ` - ${partner.business_name}`}
                            </SelectItem>
                          ))
                        ) : (
                          activeRegistrations.map(registration => (
                            <SelectItem key={registration.study_id} value={registration.study_id}>
                              {registration.study_name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t('member.documents.sharing.permissions')}</Label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="canView"
                          checked={newPermission.canView}
                          onCheckedChange={(checked) => 
                            setNewPermission(prev => ({ ...prev, canView: !!checked }))
                          }
                        />
                        <Label htmlFor="canView" className="font-normal">
                          {t('member.documents.sharing.permissionView')}
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="canStats"
                          checked={newPermission.canUseForStatistics}
                          onCheckedChange={(checked) => 
                            setNewPermission(prev => ({ ...prev, canUseForStatistics: !!checked }))
                          }
                        />
                        <Label htmlFor="canStats" className="font-normal">
                          {t('member.documents.sharing.permissionStats')}
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="canResearch"
                          checked={newPermission.canUseForResearch}
                          onCheckedChange={(checked) => 
                            setNewPermission(prev => ({ ...prev, canUseForResearch: !!checked }))
                          }
                        />
                        <Label htmlFor="canResearch" className="font-normal">
                          {t('member.documents.sharing.permissionResearch')}
                        </Label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setShowAddPermission(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button 
                    onClick={handleGrant}
                    disabled={!newPermission.targetId || grantMutation.isPending}
                  >
                    {t('member.documents.sharing.grant')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
