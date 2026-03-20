import React from 'react';
import './_group.css';
import { 
  Trophy, 
  Users, 
  TrendingUp, 
  DollarSign, 
  AlertCircle, 
  ChevronRight,
  MoreHorizontal
} from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function SidebarStats() {
  const stats = [
    {
      title: "Total Leagues",
      value: "5",
      icon: Trophy,
      trend: "+1 this month"
    },
    {
      title: "Active Bowlers",
      value: "42",
      icon: Users,
      trend: "+4 this month"
    },
    {
      title: "Total Lineage Paid",
      value: "$12,450",
      icon: TrendingUp,
      trend: "+$1,200 this week"
    },
    {
      title: "Total Prize Fund Paid",
      value: "$6,225",
      icon: DollarSign,
      trend: "+$600 this week"
    }
  ];

  const pastDueBowlers = [
    { name: "John Smith", league: "Monday Night Trios", amount: "$45.00", status: "1 week late" },
    { name: "Sarah Johnson", league: "Wednesday Rollers", amount: "$90.00", status: "2 weeks late" },
    { name: "Mike Davis", league: "Friday Night Lights", amount: "$135.00", status: "3 weeks late" },
    { name: "Emily Wilson", league: "Sunday Social", amount: "$45.00", status: "1 week late" },
    { name: "David Brown", league: "Monday Night Trios", amount: "$180.00", status: "4 weeks late" },
  ];

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar Area */}
      <aside className="w-72 bg-muted/30 border-r border-border flex flex-col hidden md:flex h-screen sticky top-0">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2 font-bold text-2xl text-primary tracking-tight">
            <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
              <Trophy className="w-5 h-5" />
            </div>
            LeagueVault
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6">
          <div className="px-6 mb-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Key Metrics
          </div>
          <div className="flex flex-col">
            {stats.map((stat, i) => (
              <div 
                key={i} 
                className="px-6 py-4 border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer group last:border-0"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <stat.icon className="w-4 h-4 text-primary/70" />
                    {stat.title}
                  </div>
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-3xl font-bold tracking-tight text-foreground">
                    {stat.value}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="p-6 mt-auto border-t border-border">
          <Button variant="outline" className="w-full justify-start gap-2">
            <Users className="w-4 h-4" />
            Manage Users
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden h-screen">
        <header className="h-16 border-b border-border flex items-center px-8 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
          <h1 className="text-xl font-semibold tracking-tight">Dashboard Overview</h1>
        </header>

        <div className="flex-1 overflow-y-auto p-8 bg-muted/10">
          <div className="max-w-6xl mx-auto space-y-8 h-full flex flex-col">
            
            {/* Top Half: Payment Distribution Chart */}
            <Card className="shadow-sm flex-none">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center justify-between">
                  Payment Distribution
                  <Badge variant="secondary" className="font-normal rounded-full">Season 2024</Badge>
                </CardTitle>
                <CardDescription>Visual breakdown of financial status across all leagues</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="pt-2">
                  <div className="flex items-end gap-2 mb-4">
                    <span className="text-4xl font-bold tracking-tight">$18,675</span>
                    <span className="text-muted-foreground text-sm mb-1">total expected</span>
                  </div>
                  
                  {/* Visual Bar representing distribution */}
                  <div className="h-6 w-full flex rounded-full overflow-hidden mb-6 bg-muted ring-1 ring-border/50">
                    <div className="bg-primary h-full transition-all" style={{ width: '65%' }} title="Paid"></div>
                    <div className="bg-yellow-500/80 h-full transition-all" style={{ width: '25%' }} title="Pending"></div>
                    <div className="bg-destructive/80 h-full transition-all" style={{ width: '10%' }} title="Overdue"></div>
                  </div>
                  
                  {/* Legend */}
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-primary"></div>
                        <span className="font-medium">Paid</span>
                      </div>
                      <span className="text-2xl font-semibold">$12,138</span>
                      <span className="text-xs text-muted-foreground">65% of total</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                        <span className="font-medium">Pending</span>
                      </div>
                      <span className="text-2xl font-semibold">$4,668</span>
                      <span className="text-xs text-muted-foreground">25% of total</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-destructive/80"></div>
                        <span className="font-medium text-destructive">Overdue</span>
                      </div>
                      <span className="text-2xl font-semibold text-destructive">$1,869</span>
                      <span className="text-xs text-muted-foreground">10% of total</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bottom Half: Past Due Bowlers Table */}
            <Card className="shadow-sm flex-1 flex flex-col overflow-hidden border-destructive/20">
              <CardHeader className="border-b bg-destructive/5 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-destructive" />
                    <CardTitle className="text-lg">Action Required: Past Due</CardTitle>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    View All
                  </Button>
                </div>
                <CardDescription className="ml-7">Bowlers with overdue payments needing attention</CardDescription>
              </CardHeader>
              <CardContent className="p-0 overflow-auto flex-1">
                <Table>
                  <TableHeader className="bg-muted/30 sticky top-0 z-10">
                    <TableRow>
                      <TableHead className="w-[250px] pl-6">Bowler</TableHead>
                      <TableHead>League</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right pr-6">Amount Due</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastDueBowlers.map((bowler, i) => (
                      <TableRow key={i} className="hover:bg-muted/30">
                        <TableCell className="font-medium pl-6">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                                {bowler.name.split(' ').map(n => n[0]).join('')}
                              </AvatarFallback>
                            </Avatar>
                            {bowler.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{bowler.league}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/5 font-normal">
                            {bowler.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6 font-semibold tabular-nums">
                          {bowler.amount}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

          </div>
        </div>
      </main>
    </div>
  );
}
