import { useState } from "react";
import { safeError } from "@/lib/security/safeLogger";
import { useTranslation } from "react-i18next";
import { useInvitations, type Invitation } from "@/hooks/useInvitations";
import { useStudies } from "@/hooks/useStudies";
import { useMyPartnerProfile } from "@/hooks/usePartners";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Plus, Copy, Mail, Users, Info } from "lucide-react";
import { toast } from "sonner";

export function PartnerInvitations() {
  const { t } = useTranslation();
  const { invitations, isLoading, createInvitation, toggleInvitation } = useInvitations();
  const { studies } = useStudies();
  const { data: partnerProfile } = useMyPartnerProfile();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreatingBulk, setIsCreatingBulk] = useState(false);
  const [newInvite, setNewInvite] = useState({
    code: "",
    study_id: "null",
    max_uses: "",
    emails: "", // Changed from single email to multiple emails (comma-separated)
    prefill_first_name: "",
    prefill_last_name: "",
    prefill_phone: "",
    prefill_notes: "",
  });

  // Filter invitations created by this partner
  const myInvitations = invitations?.filter(inv => inv.created_by === partnerProfile?.user_id) || [];

  const handleCreate = async () => {
    setIsCreatingBulk(true);
    try {
      // Parse emails - split by comma, semicolon, newline, or space
      const emailList = newInvite.emails
        .split(/[,;\n\s]+/)
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0 && e.includes('@'));
      
      // If no valid emails, create one invitation without email
      if (emailList.length === 0) {
        await createInvitation.mutateAsync({
          study_id: newInvite.study_id === "null" ? null : newInvite.study_id,
          role: "member",
          max_uses: newInvite.max_uses ? Math.max(1, parseInt(newInvite.max_uses, 10)) : null,
          email: null,
          prefill_first_name: newInvite.prefill_first_name || null,
          prefill_last_name: newInvite.prefill_last_name || null,
          prefill_phone: newInvite.prefill_phone || null,
          prefill_notes: newInvite.prefill_notes || null,
          ...(newInvite.code.trim() ? { code: newInvite.code } : {}),
        });
        toast(t("invitations.created"));
      } else {
        // Create one invitation per email
        let successCount = 0;
        let errorCount = 0;
        
        for (const email of emailList) {
          try {
            await createInvitation.mutateAsync({
              study_id: newInvite.study_id === "null" ? null : newInvite.study_id,
              role: "member",
              max_uses: 1, // Each personalized invitation can be used once
              email: email,
              prefill_first_name: newInvite.prefill_first_name || null,
              prefill_last_name: newInvite.prefill_last_name || null,
              prefill_phone: newInvite.prefill_phone || null,
              prefill_notes: newInvite.prefill_notes || null,
              // Don't use custom code for bulk invitations
            });
            successCount++;
          } catch (e) {
            errorCount++;
            safeError("PartnerInvitations.bulkInvite", e);
          }
        }
        
        if (successCount > 0) {
          toast.success(t("invitations.bulkCreated"), {
            description: t("invitations.bulkCreatedDesc", { count: successCount }),
          });
        }
        if (errorCount > 0) {
          toast.error(t("common.warning"), {
            description: t("invitations.bulkErrors", { count: errorCount }),
          });
        }
      }
      
      setIsCreateOpen(false);
      setNewInvite({ 
        code: "", 
        study_id: "null", 
        max_uses: "", 
        emails: "",
        prefill_first_name: "",
        prefill_last_name: "",
        prefill_phone: "",
        prefill_notes: "",
      });
    } catch (error) {
      toast.error(t("common.error"), { description: t("common.tryAgain") });
    } finally {
      setIsCreatingBulk(false);
    }
  };

  const copyLink = (code: string) => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      toast.error(t("common.error"), { description: t("common.tryAgain") });
      return;
    }

    if (!navigator.clipboard?.writeText) {
      toast.error(t("common.error"), { description: t("common.tryAgain") });
      return;
    }

    const url = `${window.location.origin}/promo/${code}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast(t("common.copied")))
      .catch(() => toast.error(t("common.error"), { description: t("common.tryAgain") }));
  };

  const sendEmail = (invite: Invitation) => {
    if (!invite.email) return;
    if (typeof window === "undefined") {
      toast.error(t("common.error"), { description: t("common.tryAgain") });
      return;
    }

    const url = `${window.location.origin}/promo/${invite.code}`;
    const subject = t("invitations.email_subject");
    const body = t("invitations.email_body", { url });
    window.location.href = `mailto:${invite.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; // external mailto
  };

  // Get active studies that partner can invite to
  const availableStudies = studies?.filter(s => s.is_active) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info Alert */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          {t("partnerDashboard.invitations.info")}
        </AlertDescription>
      </Alert>

      {/* Header with Create Button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t("partnerDashboard.invitations.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("partnerDashboard.invitations.subtitle")}
          </p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t("invitations.create_new")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("invitations.create_new")}</DialogTitle>
              <DialogDescription>
                {t("partnerDashboard.invitations.createDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>{t("invitations.code_optional")}</Label>
                <Input
                  placeholder={t("invitations.code_placeholder")}
                  value={newInvite.code}
                  onChange={(e) => setNewInvite({ ...newInvite, code: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t("invitations.code_hint")}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label>{t("invitations.study")}</Label>
                <Select
                  value={newInvite.study_id}
                  onValueChange={(v) => setNewInvite({ ...newInvite, study_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("invitations.select_study")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="null">{t("invitations.no_study")}</SelectItem>
                    {availableStudies.map((study) => (
                      <SelectItem key={study.id} value={study.id}>
                        {study.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>{t("invitations.max_uses")}</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder={t("invitations.unlimited")}
                  value={newInvite.max_uses}
                  onChange={(e) => setNewInvite({ ...newInvite, max_uses: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label>{t("invitations.emails_label")}</Label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={t("invitations.emails_placeholder")}
                  value={newInvite.emails}
                  onChange={(e) => setNewInvite({ ...newInvite, emails: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t("invitations.emails_hint")}
                </p>
              </div>

              {/* Profile Prefill Section */}
              <div className="border-t pt-4 mt-4">
                <p className="text-sm font-medium mb-3">
                  {t("partnerDashboard.invitations.prefillTitle")}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{t("common.firstName")}</Label>
                    <Input
                      placeholder={t("common.firstName")}
                      value={newInvite.prefill_first_name}
                      onChange={(e) => setNewInvite({ ...newInvite, prefill_first_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("common.lastName")}</Label>
                    <Input
                      placeholder={t("common.lastName")}
                      value={newInvite.prefill_last_name}
                      onChange={(e) => setNewInvite({ ...newInvite, prefill_last_name: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2 mt-3">
                  <Label>{t("common.phone")}</Label>
                  <Input
                    type="tel"
                    placeholder="+420 123 456 789"
                    value={newInvite.prefill_phone}
                    onChange={(e) => setNewInvite({ ...newInvite, prefill_phone: e.target.value })}
                  />
                </div>
                <div className="space-y-2 mt-3">
                  <Label>{t("partnerDashboard.invitations.internalNotes")}</Label>
                  <Input
                    placeholder={t("partnerDashboard.invitations.notesPlaceholder")}
                    value={newInvite.prefill_notes}
                    onChange={(e) => setNewInvite({ ...newInvite, prefill_notes: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("partnerDashboard.invitations.notesHint")}
                  </p>
                </div>
              </div>

              <Button 
                onClick={handleCreate} 
                className="w-full" 
                disabled={createInvitation.isPending || isCreatingBulk}
              >
                {(createInvitation.isPending || isCreatingBulk) ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("common.loading")}
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    {t("common.create")}
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Invitations Table */}
      {myInvitations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t("partnerDashboard.invitations.empty")}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t("partnerDashboard.invitations.emptyDesc")}
            </p>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t("invitations.create_new")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invitations.code")}</TableHead>
                <TableHead>{t("invitations.study")}</TableHead>
                <TableHead>{t("invitations.uses")}</TableHead>
                <TableHead>{t("invitations.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {myInvitations.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <code className="text-sm bg-muted px-2 py-1 rounded">{inv.code}</code>
                        {inv.email && (
                          <Badge variant="outline" className="text-xs">
                            {inv.email}
                          </Badge>
                        )}
                      </div>
                      {(inv.prefill_first_name || inv.prefill_last_name) && (
                        <div className="flex items-center gap-1">
                          <Badge variant="secondary" className="text-xs">
                            {[inv.prefill_first_name, inv.prefill_last_name].filter(Boolean).join(" ")}
                          </Badge>
                          {inv.prefill_phone && (
                            <span className="text-xs text-muted-foreground">{inv.prefill_phone}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {inv.study?.name || (
                      <span className="text-muted-foreground">{t("invitations.general")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="tabular-nums">
                      {inv.used_count} / {inv.max_uses || "∞"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={inv.is_active}
                        onCheckedChange={(checked) =>
                          toggleInvitation.mutate({ id: inv.id, is_active: checked })
                        }
                      />
                      <Badge variant={inv.is_active ? "default" : "secondary"}>
                        {inv.is_active ? t("common.active") : t("common.inactive")}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyLink(inv.code)}
                        title={t("invitations.copy_link")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      {inv.email && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => sendEmail(inv)}
                          title={t("invitations.send_email")}
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{myInvitations.length}</p>
              <p className="text-sm text-muted-foreground">{t("partnerDashboard.invitations.total")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{myInvitations.filter(i => i.is_active).length}</p>
              <p className="text-sm text-muted-foreground">{t("partnerDashboard.invitations.active")}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{myInvitations.reduce((sum, i) => sum + i.used_count, 0)}</p>
              <p className="text-sm text-muted-foreground">{t("partnerDashboard.invitations.used")}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
