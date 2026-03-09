import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Mail, Pencil, Eye, EyeOff, Info, Send, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { EmailTemplate, Organization, ApiResponse } from "@shared/schema";

const TEMPLATE_VARIABLES = [
  { name: "{{bowler_name}}", description: "The bowler/user's name" },
  { name: "{{organization_name}}", description: "The organization name" },
  { name: "{{organization_logo}}", description: "The org's logo URL (for email header)" },
  { name: "{{league_name}}", description: "The league name (if applicable)" },
  { name: "{{invite_link}}", description: "The password setup link (for invite emails)" },
  { name: "{{login_link}}", description: "Link to the login page" },
  { name: "{{dashboard_link}}", description: "Link to the bowler dashboard" },
];

const SAMPLE_DATA: Record<string, string> = {
  "{{bowler_name}}": "John Smith",
  "{{organization_name}}": "Perfect Game Bowling",
  "{{organization_logo}}": "https://example.com/logo.png",
  "{{league_name}}": "Wednesday Night Mixed",
  "{{invite_link}}": "https://leaguevault.com/set-password?token=abc123",
  "{{login_link}}": "https://leaguevault.com/login",
  "{{dashboard_link}}": "https://leaguevault.com/bowler-dashboard",
};

function replaceVariables(text: string, data: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(data)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

export default function EmailTemplatesPage() {
  const { toast } = useToast();
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testOrgId, setTestOrgId] = useState<string>("");

  const { data: templatesResponse, isLoading } = useQuery<ApiResponse<EmailTemplate[]>>({
    queryKey: ["/api/admin/email-templates"],
  });

  const { data: orgsResponse } = useQuery<ApiResponse<Organization[]>>({
    queryKey: ["/api/organizations"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { subject?: string; body?: string; active?: boolean } }) => {
      return apiRequest(`/api/admin/email-templates/${id}`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-templates"] });
      toast({ title: "Template Updated", description: "Email template saved successfully." });
      setEditingTemplate(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      return apiRequest(`/api/admin/email-templates/${id}`, "PATCH", { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-templates"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const sendTestMutation = useMutation({
    mutationFn: async ({ id, toEmail, organizationId }: { id: number; toEmail: string; organizationId?: string }) => {
      return apiRequest(`/api/admin/email-templates/${id}/send-test`, "POST", { toEmail, organizationId: organizationId || undefined });
    },
    onSuccess: () => {
      toast({ title: "Test Email Sent", description: `A sample email was sent to ${testEmail}.` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to Send", description: error.message, variant: "destructive" });
    },
  });

  const openEditor = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setEditSubject(template.subject);
    setEditBody(template.body);
    setEditActive(template.active);
    setShowPreview(false);
  };

  const handleSave = () => {
    if (!editingTemplate) return;
    updateMutation.mutate({
      id: editingTemplate.id,
      data: { subject: editSubject, body: editBody, active: editActive },
    });
  };

  const templates = templatesResponse?.data || [];

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Templates</h1>
          <p className="text-muted-foreground">Manage the email templates sent to bowlers during registration and account events.</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {templates.map((template) => (
              <Card key={template.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Mail className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={template.active ? "default" : "secondary"}>
                        {template.active ? "Active" : "Inactive"}
                      </Badge>
                      <Switch
                        checked={template.active}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: template.id, active: checked })}
                      />
                    </div>
                  </div>
                  {template.description && (
                    <CardDescription>{template.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</span>
                      <p className="text-sm mt-0.5 truncate">{template.subject}</p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Body Preview</span>
                      <p className="text-sm mt-0.5 line-clamp-3 text-muted-foreground whitespace-pre-line">{template.body}</p>
                    </div>
                    <Button variant="outline" size="sm" className="mt-2" onClick={() => openEditor(template)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Edit Template
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={!!editingTemplate} onOpenChange={(open) => { if (!open) setEditingTemplate(null); }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Edit: {editingTemplate?.name}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Label htmlFor="active-toggle">Active</Label>
                  <Switch id="active-toggle" checked={editActive} onCheckedChange={setEditActive} />
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}>
                  {showPreview ? <EyeOff className="h-4 w-4 mr-1.5" /> : <Eye className="h-4 w-4 mr-1.5" />}
                  {showPreview ? "Hide Preview" : "Show Preview"}
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">Subject Line</Label>
                <Input id="subject" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} placeholder="Email subject..." />
              </div>

              <div className="space-y-2">
                <Label htmlFor="body">Email Body (Plain Text)</Label>
                <Textarea id="body" value={editBody} onChange={(e) => setEditBody(e.target.value)} placeholder="Email body..." rows={12} className="font-mono text-sm" />
              </div>

              <div className="rounded-lg border bg-muted/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Available Template Variables</span>
                </div>
                <div className="grid gap-1.5">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <div key={v.name} className="flex items-center gap-3 text-sm">
                      <code className="bg-background px-2 py-0.5 rounded text-xs font-mono border">{v.name}</code>
                      <span className="text-muted-foreground">{v.description}</span>
                    </div>
                  ))}
                </div>
              </div>

              {showPreview && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium">Preview (with sample data)</h4>
                    <div className="rounded-lg border bg-white p-6 space-y-4">
                      <div className="text-center pb-4 border-b">
                        <img src={SAMPLE_DATA["{{organization_logo}}"]} alt="Organization Logo" className="h-12 mx-auto" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        <p className="text-xs text-muted-foreground mt-1">Organization logo will appear here</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</span>
                        <p className="text-sm font-medium mt-0.5">{replaceVariables(editSubject, SAMPLE_DATA)}</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Body</span>
                        <div className="text-sm mt-1 whitespace-pre-line bg-gray-50 rounded p-4">
                          {replaceVariables(editBody, SAMPLE_DATA)}
                        </div>
                      </div>
                      <div className="text-center pt-4 border-t text-xs text-muted-foreground">
                        Sent by LeagueVault
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Send className="h-4 w-4" />
                Send Test Email
              </Label>
              <div className="space-y-2">
                <div>
                  <Label htmlFor="test-org" className="text-xs text-muted-foreground mb-1 block">Organization</Label>
                  <Select value={testOrgId} onValueChange={setTestOrgId}>
                    <SelectTrigger id="test-org">
                      <SelectValue placeholder="Sample data (no real org)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sample data (no real org)</SelectItem>
                      {(orgsResponse?.data || []).map((org) => (
                        <SelectItem key={org.id} value={String(org.id)}>
                          <span className="flex items-center gap-2">
                            {org.logo ? (
                              <img src={org.logo} alt="" className="h-4 w-4 rounded object-contain" />
                            ) : (
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                            )}
                            {org.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="test-email-input" className="text-xs text-muted-foreground mb-1 block">Recipient</Label>
                  <div className="flex gap-2">
                    <Input
                      id="test-email-input"
                      type="email"
                      placeholder="Enter email address..."
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (!editingTemplate || !testEmail) return;
                        sendTestMutation.mutate({
                          id: editingTemplate.id,
                          toEmail: testEmail,
                          organizationId: testOrgId && testOrgId !== "none" ? testOrgId : undefined,
                        });
                      }}
                      disabled={sendTestMutation.isPending || !testEmail}
                    >
                      {sendTestMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-1.5" />
                      )}
                      Send Test
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose an organization to test with their real name and logo, or use sample data. Subject will be prefixed with [TEST].
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingTemplate(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}