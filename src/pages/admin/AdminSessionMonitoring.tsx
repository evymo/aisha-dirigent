import { useState, useMemo } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { format, formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Search, RefreshCw, Eye, Shield, AlertTriangle, 
  Users, Activity, Globe, Monitor, Smartphone, Clock,
  CheckCircle, TrendingUp, MapPin,
  Laptop, Tablet, Lock
} from "lucide-react";
import { 
  useSessionMonitoring, 
  useSessionStats, 
  useSuspiciousPatterns,
  useResolvePattern,
  SessionActivity,
  SuspiciousPattern
} from "@/hooks/useSessionMonitoring";
import { 
  PieChart, Pie, Cell, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid
} from "recharts";

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  Desktop: <Monitor className="h-4 w-4" />,
  Mobile: <Smartphone className="h-4 w-4" />,
  Tablet: <Tablet className="h-4 w-4" />,
  Unknown: <Laptop className="h-4 w-4" />,
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const PATTERN_KEYS: Record<string, string> = {
  rapid_requests: "rapidRequests",
  geo_anomaly: "geoAnomaly",
  brute_force: "bruteForce",
  unusual_hours: "unusualHours",
  multiple_sessions: "multipleSessions",
  data_exfiltration: "dataExfiltration",
};

const CHART_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

function StatsOverview() {
  const { t } = useTranslation();
  const stats = useSessionStats();

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("admin.sessionMonitoring.stats.activeSessions")}</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalActiveSessions}</div>
          <p className="text-xs text-muted-foreground">
            {stats.uniqueUsers} {t("admin.sessionMonitoring.stats.uniqueUsers")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("admin.sessionMonitoring.stats.suspiciousActivity")}</CardTitle>
          <AlertTriangle className="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-destructive">{stats.suspiciousSessions}</div>
          <p className="text-xs text-muted-foreground">
            {stats.failedLogins} {t("admin.sessionMonitoring.stats.failedLogins")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("admin.sessionMonitoring.stats.avgSessionDuration")}</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {stats.avgSessionDuration} {t("common.unitMinuteShort")}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("admin.sessionMonitoring.stats.peakHour")}: {stats.peakHour}
            {t("common.timeHourSuffix")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("common.recentLogins")}</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.recentLogins}</div>
          <p className="text-xs text-muted-foreground">
            {stats.rateLimit.violations} {t("admin.sessionMonitoring.rateLimit.violations")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SessionCharts() {
  const { t } = useTranslation();
  const stats = useSessionStats();

  const deviceData = stats.deviceBreakdown.map(d => ({
    name: d.device,
    value: d.count,
  }));

  const countryData = stats.topCountries.map(c => ({
    name: c.country,
    sessions: c.count,
  }));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("admin.sessionMonitoring.charts.deviceDistribution")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={deviceData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {deviceData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("admin.sessionMonitoring.charts.geoDistribution")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={countryData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="sessions" fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">{t("admin.sessionMonitoring.charts.hourlyActivity")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={stats.hourlyActivity}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="sessions" stroke="#8884d8" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function SessionDetail({ session }: { session: SessionActivity }) {
  const { t } = useTranslation();
  
  return (
    <ScrollArea className="h-[500px]">
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.user")}</p>
            <p className="font-medium">{session.user_email || t("admin.sessionMonitoring.detail.unknown")}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.role")}</p>
            <Badge variant="outline">{session.user_role || 'N/A'}</Badge>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.ipAddress")}</p>
            <p className="font-mono">{session.ip_address || 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.location")}</p>
            <p>{session.city ? `${session.city}, ${session.country}` : session.country || t("admin.sessionMonitoring.detail.unknownLocation")}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.device")}</p>
            <div className="flex items-center gap-2">
              {DEVICE_ICONS[session.device_type || 'Unknown']}
              <span>{session.device_type}</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.browserOs")}</p>
            <p>{session.browser} / {session.os}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.firstActivity")}</p>
            <p>{format(new Date(session.first_seen_at), "dd.MM.yyyy HH:mm:ss")}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.lastActivity")}</p>
            <p>{format(new Date(session.last_activity_at), "dd.MM.yyyy HH:mm:ss")}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.actionsCount")}</p>
            <p>{session.activity_count}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("admin.sessionMonitoring.detail.riskScore")}</p>
            <div className="flex items-center gap-2">
              <Progress value={session.risk_score} className="w-20" />
              <span className={session.risk_score > 50 ? "text-destructive" : ""}>{session.risk_score}%</span>
            </div>
          </div>
        </div>

        {session.is_suspicious && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("admin.sessionMonitoring.suspicious.title")}</AlertTitle>
            <AlertDescription>
              {session.suspicious_reason || t("admin.sessionMonitoring.suspicious.detected")}
            </AlertDescription>
          </Alert>
        )}

        <div className="border-t pt-4">
          <p className="text-sm font-medium mb-2">{t("admin.sessionMonitoring.detail.userAgent")}</p>
          <p className="text-xs text-muted-foreground font-mono break-all">
            {session.user_agent || 'N/A'}
          </p>
        </div>
      </div>
    </ScrollArea>
  );
}

function ActiveSessionsTable() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "suspicious">("all");
  const [selectedSession, setSelectedSession] = useState<SessionActivity | null>(null);

  const { data: sessions, isLoading, refetch } = useSessionMonitoring({
    activeOnly: filter === "active",
    suspiciousOnly: filter === "suspicious",
    limit: 100,
  });

  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    if (!search) return sessions;
    
    const searchLower = search.toLowerCase();
    return sessions.filter(s => 
      s.user_email?.toLowerCase().includes(searchLower) ||
      s.ip_address?.includes(search) ||
      s.country?.toLowerCase().includes(searchLower)
    );
  }, [sessions, search]);

  const dateLocale = getDateFnsLocale(i18n.language);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t("admin.sessionMonitoring.tabs.sessions")}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("admin.sessionMonitoring.refresh")}
          </Button>
        </div>
        <div className="flex gap-4 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("admin.auditJournal.filters.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("admin.sessionMonitoring.filter.all")}</SelectItem>
              <SelectItem value="active">{t("admin.sessionMonitoring.filter.active")}</SelectItem>
              <SelectItem value="suspicious">{t("admin.sessionMonitoring.filter.suspicious")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.sessionMonitoring.table.user")}</TableHead>
              <TableHead>{t("admin.sessionMonitoring.table.ipLocation")}</TableHead>
              <TableHead>{t("admin.sessionMonitoring.table.device")}</TableHead>
              <TableHead>{t("admin.sessionMonitoring.table.lastActivity")}</TableHead>
              <TableHead>{t("admin.sessionMonitoring.table.risk")}</TableHead>
              <TableHead>{t("admin.sessionMonitoring.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSessions.map((session) => (
              <TableRow key={session.id} className={session.is_suspicious ? "bg-destructive/10" : ""}>
                <TableCell>
                  <div>
                    <p className="font-medium">{session.user_email || t("admin.sessionMonitoring.detail.unknown")}</p>
                    <p className="text-xs text-muted-foreground">{session.user_role}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    <div>
                      <p className="font-mono text-sm">{session.ip_address || 'N/A'}</p>
                      <p className="text-xs text-muted-foreground">{session.country || t("admin.sessionMonitoring.detail.unknownLocation")}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {DEVICE_ICONS[session.device_type || 'Unknown']}
                    <span className="text-sm">{session.browser}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="text-sm">
                      {formatDistanceToNow(new Date(session.last_activity_at), { 
                        addSuffix: true, 
                        locale: dateLocale 
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.activity_count} {t("admin.sessionMonitoring.actions")}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={session.risk_score} className="w-16 h-2" />
                    <span className={`text-sm ${session.risk_score > 50 ? 'text-destructive font-medium' : ''}`}>
                      {session.risk_score}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => setSelectedSession(session)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>{t("admin.sessionMonitoring.detail.title")}</DialogTitle>
                        <DialogDescription>
                          {t("admin.sessionMonitoring.detail.description")}
                        </DialogDescription>
                      </DialogHeader>
                      {selectedSession && <SessionDetail session={selectedSession} />}
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredSessions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            {t("common.noResults")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SuspiciousPatternsTable() {
  const { t } = useTranslation();
  const { data: patterns, isLoading } = useSuspiciousPatterns({ resolved: false });
  const resolvePattern = useResolvePattern();
  const [resolveNotes, setResolveNotes] = useState("");
  const [selectedPattern, setSelectedPattern] = useState<SuspiciousPattern | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          {t("admin.sessionMonitoring.patterns.title")}
        </CardTitle>
        <CardDescription>
          {t("admin.sessionMonitoring.suspicious.detected")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {patterns && patterns.length > 0 ? (
          <div className="space-y-4">
            {patterns.map((pattern) => (
              <Alert key={pattern.id} variant={pattern.severity === 'critical' ? 'destructive' : 'default'}>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="flex items-center justify-between">
                  <span>{t(`admin.sessionMonitoring.patterns.${PATTERN_KEYS[pattern.pattern_type] || pattern.pattern_type}`)}</span>
                  <Badge className={SEVERITY_COLORS[pattern.severity]}>
                    {pattern.severity}
                  </Badge>
                </AlertTitle>
                <AlertDescription>
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">{t("admin.sessionMonitoring.detail.user")}: </span>
                        <span>{pattern.user_email || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t("common.ipLabel")}</span>
                        <span className="font-mono">{pattern.ip_address || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{t("common.detected")}: </span>
                        <span>{format(new Date(pattern.detected_at), "dd.MM.yyyy HH:mm")}</span>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-4">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setSelectedPattern(pattern)}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            {t("admin.sessionMonitoring.patterns.resolve")}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t("admin.sessionMonitoring.patterns.resolve")}</DialogTitle>
                            <DialogDescription>
                              {t("admin.sessionMonitoring.patterns.resolveDescription")}
                            </DialogDescription>
                          </DialogHeader>
                          <Textarea
                            placeholder={t("admin.sessionMonitoring.patterns.notesPlaceholder")}
                            value={resolveNotes}
                            onChange={(e) => setResolveNotes(e.target.value)}
                          />
                          <DialogFooter>
                            <Button 
                              onClick={() => {
                                if (selectedPattern) {
                                  resolvePattern.mutate({ 
                                    patternId: selectedPattern.id, 
                                    notes: resolveNotes 
                                  });
                                }
                              }}
                              disabled={resolvePattern.isPending}
                            >
                              {t("common.confirm")}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t("admin.sessionMonitoring.patterns.noPatterns")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RateLimitStatus() {
  const { t } = useTranslation();
  const stats = useSessionStats();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          {t("admin.sessionMonitoring.rateLimit.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">{t("admin.sessionMonitoring.rateLimit.violations")}</span>
            <Badge variant={stats.rateLimit.violations > 0 ? "destructive" : "secondary"}>
              {stats.rateLimit.violations}
            </Badge>
          </div>

          {stats.rateLimit.violationIPs.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">{t("admin.sessionMonitoring.rateLimit.blockedIPs")}</p>
              <div className="space-y-1">
                {stats.rateLimit.violationIPs.map((ip) => (
                  <div key={ip} className="flex items-center justify-between p-2 bg-muted rounded">
                    <span className="font-mono text-sm">{ip}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.rateLimit.violationIPs.length === 0 && stats.rateLimit.violations === 0 && (
            <div className="text-center py-4 text-muted-foreground">
              <Lock className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("admin.sessionMonitoring.rateLimit.noViolations")}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminSessionMonitoring() {
  const { t } = useTranslation();
  
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("admin.sessionMonitoring.title")}</h1>
        <p className="text-muted-foreground">
          {t("admin.sessionMonitoring.subtitle")}
        </p>
      </div>

      <StatsOverview />

      <Tabs defaultValue="sessions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sessions">
            <Users className="h-4 w-4 mr-2" />
            {t("admin.sessionMonitoring.tabs.sessions")}
          </TabsTrigger>
          <TabsTrigger value="suspicious">
            <AlertTriangle className="h-4 w-4 mr-2" />
            {t("admin.sessionMonitoring.tabs.suspicious")}
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <Activity className="h-4 w-4 mr-2" />
            {t("admin.sessionMonitoring.tabs.analytics")}
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="h-4 w-4 mr-2" />
            {t("admin.sessionMonitoring.tabs.security")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <ActiveSessionsTable />
        </TabsContent>

        <TabsContent value="suspicious">
          <SuspiciousPatternsTable />
        </TabsContent>

        <TabsContent value="analytics">
          <SessionCharts />
        </TabsContent>

        <TabsContent value="security">
          <div className="grid gap-4 md:grid-cols-2">
            <RateLimitStatus />
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  {t("admin.sessionMonitoring.geoRestrictions.title")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  {t("admin.sessionMonitoring.geoRestrictions.description")}
                </p>
                <Button variant="outline" className="mt-4">
                  {t("admin.sessionMonitoring.geoRestrictions.configure")}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
