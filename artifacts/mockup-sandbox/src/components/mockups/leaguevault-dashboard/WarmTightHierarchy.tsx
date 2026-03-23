import React, { useState } from "react";
import { 
  Trophy, 
  Users, 
  TrendingUp, 
  DollarSign, 
  Settings, 
  CreditCard, 
  Plug, 
  LayoutDashboard, 
  ChevronRight,
  ChevronLeft,
  Bell,
  Search,
  MoreHorizontal
} from "lucide-react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export function WarmTightHierarchy() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navigation = [
    { name: "Dashboard", icon: LayoutDashboard, current: true },
    { name: "Leagues", icon: Trophy, current: false },
    { name: "Bowlers", icon: Users, current: false },
    { name: "Payments", icon: CreditCard, current: false },
    { name: "Integrations", icon: Plug, current: false },
    { name: "Settings", icon: Settings, current: false },
  ];

  const pastDueBowlers = [
    { id: 1, name: "Michael Chang", league: "Tuesday Night Trios", amountDue: 45.00, weeksOverdue: 2, lastPaid: "Oct 12, 2023" },
    { id: 2, name: "Sarah Jenkins", league: "Weekend Warriors", amountDue: 120.50, weeksOverdue: 4, lastPaid: "Sep 28, 2023" },
    { id: 3, name: "David Rodriguez", league: "Friday Corporate League", amountDue: 30.00, weeksOverdue: 1, lastPaid: "Oct 19, 2023" },
    { id: 4, name: "Emily Chen", league: "Tuesday Night Trios", amountDue: 90.00, weeksOverdue: 3, lastPaid: "Oct 05, 2023" },
  ];

  return (
    <div className="min-h-screen bg-stone-50 text-slate-800 font-sans flex">
      {/* Sidebar */}
      <aside 
        className={`${
          sidebarOpen ? "w-64" : "w-20"
        } bg-slate-900 text-slate-300 transition-all duration-300 ease-in-out flex flex-col border-r border-slate-800 shadow-xl z-20 shrink-0`}
      >
        <div className="h-16 flex items-center px-4 border-b border-slate-800 justify-between">
          {sidebarOpen ? (
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-8 h-8 rounded-md bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shrink-0 shadow-sm shadow-amber-900/50">
                <Trophy className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-lg tracking-tight text-white whitespace-nowrap">LeagueVault</span>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shrink-0 mx-auto shadow-sm shadow-amber-900/50">
              <Trophy className="w-5 h-5 text-white" />
            </div>
          )}
        </div>

        <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                className={`w-full flex items-center ${
                  sidebarOpen ? "px-3" : "justify-center px-0"
                } py-2.5 rounded-md transition-colors group ${
                  item.current 
                    ? "bg-amber-500/10 text-amber-500 font-medium" 
                    : "hover:bg-slate-800 hover:text-white"
                }`}
                title={!sidebarOpen ? item.name : undefined}
              >
                <Icon className={`w-5 h-5 shrink-0 ${item.current ? "text-amber-500" : "text-slate-400 group-hover:text-slate-300"}`} />
                {sidebarOpen && <span className="ml-3 truncate">{item.name}</span>}
                {sidebarOpen && item.current && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-center">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex items-center justify-center w-8 h-8 text-slate-500 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
          >
            {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-stone-200 flex items-center justify-between px-6 shrink-0 sticky top-0 z-10 shadow-sm shadow-stone-200/50">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-slate-800 tracking-tight">Dashboard</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input 
                type="text" 
                placeholder="Search bowlers or leagues..." 
                className="w-64 pl-9 bg-stone-50 border-stone-200 focus-visible:ring-amber-500 h-9 text-sm rounded-lg"
              />
            </div>
            
            <button className="relative p-2 text-slate-400 hover:text-slate-600 transition-colors rounded-full hover:bg-stone-100">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-500 rounded-full border border-white" />
            </button>
            
            <div className="h-6 w-px bg-stone-200 mx-1"></div>
            
            <button className="flex items-center gap-2 hover:bg-stone-50 p-1 pr-2 rounded-full transition-colors border border-transparent hover:border-stone-200">
              <Avatar className="w-8 h-8 border border-stone-200">
                <AvatarImage src="https://i.pravatar.cc/150?u=a042581f4e29026704d" alt="Admin user" />
                <AvatarFallback className="bg-amber-100 text-amber-700 font-medium">JD</AvatarFallback>
              </Avatar>
              <div className="hidden md:flex flex-col items-start">
                <span className="text-sm font-medium text-slate-700 leading-none">John Davis</span>
                <span className="text-xs text-slate-500 mt-1">League Secretary</span>
              </div>
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-6xl mx-auto space-y-8">
            
            {/* Welcome Section */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Welcome back, John</h2>
                <p className="text-sm text-slate-500 mt-1">Here's what's happening across your leagues today.</p>
              </div>
              <Button className="bg-amber-600 hover:bg-amber-700 text-white shadow-sm shadow-amber-600/20 rounded-md px-6 h-10">
                + New League
              </Button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              <Card className="border-stone-200 shadow-sm hover:shadow-md transition-shadow duration-200 bg-white group border-l-4 border-l-amber-400">
                <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
                  <CardTitle className="text-sm font-medium text-slate-500">Active Leagues</CardTitle>
                  <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                    <Trophy className="w-5 h-5" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-slate-800 tracking-tight">12</div>
                  <p className="text-xs text-emerald-600 font-medium mt-1 flex items-center">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    +2 from last season
                  </p>
                </CardContent>
              </Card>

              <Card className="border-stone-200 shadow-sm hover:shadow-md transition-shadow duration-200 bg-white group">
                <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
                  <CardTitle className="text-sm font-medium text-slate-500">Active Bowlers</CardTitle>
                  <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                    <Users className="w-5 h-5" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-slate-800 tracking-tight">148</div>
                  <p className="text-xs text-emerald-600 font-medium mt-1 flex items-center">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    +15 new signups
                  </p>
                </CardContent>
              </Card>

              <Card className="border-stone-200 shadow-sm hover:shadow-md transition-shadow duration-200 bg-white group">
                <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
                  <CardTitle className="text-sm font-medium text-slate-500">Total Lineage Paid</CardTitle>
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-slate-800 tracking-tight">$24,850</div>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    Year to date
                  </p>
                </CardContent>
              </Card>

              <Card className="border-stone-200 shadow-sm hover:shadow-md transition-shadow duration-200 bg-white group">
                <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
                  <CardTitle className="text-sm font-medium text-slate-500">Total Prize Fund</CardTitle>
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                    <DollarSign className="w-5 h-5" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-slate-800 tracking-tight">$18,320</div>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    Projected final payout
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Past Due Bowlers Section */}
            <Card className="border-stone-200 shadow-sm bg-white overflow-hidden">
              <CardHeader className="border-b border-stone-100 bg-stone-50/50 flex flex-row items-center justify-between py-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-800">Action Required: Past Due Balances</CardTitle>
                    <CardDescription className="text-slate-500 mt-1">Bowlers who have missed payments across all active leagues.</CardDescription>
                  </div>
                </div>
                <Button variant="outline" className="border-stone-200 text-slate-600 hover:text-slate-800 hover:bg-stone-50 hidden sm:flex h-9 rounded-md">
                  View All
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-stone-100">
                    <TableRow className="border-stone-200 hover:bg-transparent">
                      <TableHead className="text-slate-600 font-medium py-3 pl-6">Bowler Name</TableHead>
                      <TableHead className="text-slate-600 font-medium py-3">League</TableHead>
                      <TableHead className="text-slate-600 font-medium py-3 text-center">Status</TableHead>
                      <TableHead className="text-slate-600 font-medium py-3">Last Paid</TableHead>
                      <TableHead className="text-slate-600 font-medium text-right py-3">Amount Due</TableHead>
                      <TableHead className="text-right py-3 pr-6"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastDueBowlers.map((bowler, idx) => (
                      <TableRow 
                        key={bowler.id} 
                        className={`border-stone-100 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-stone-50/50'} hover:bg-stone-100`}
                      >
                        <TableCell className="font-medium text-slate-800 py-3 pl-6">
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8 border border-stone-200 shadow-sm">
                              <AvatarFallback className="bg-amber-100 text-amber-700 text-xs">
                                {bowler.name.split(' ').map(n => n[0]).join('')}
                              </AvatarFallback>
                            </Avatar>
                            {bowler.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 py-3">{bowler.league}</TableCell>
                        <TableCell className="py-3 text-center">
                          <Badge 
                            variant="secondary" 
                            className={`
                              ${bowler.weeksOverdue > 2 
                                ? 'bg-red-50 text-red-700 border border-red-200/50' 
                                : 'bg-amber-50 text-amber-700 border border-amber-200/50'} 
                              font-medium shadow-sm
                            `}
                          >
                            {bowler.weeksOverdue} {bowler.weeksOverdue === 1 ? 'week' : 'weeks'} overdue
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-500 text-sm py-3">{bowler.lastPaid}</TableCell>
                        <TableCell className="text-right font-bold text-slate-800 py-3">
                          ${bowler.amountDue.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right py-3 pr-6">
                          <Button variant="ghost" size="icon" className="text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-full h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                <div className="p-4 border-t border-stone-100 bg-stone-50/50 flex justify-center sm:hidden">
                  <Button variant="outline" className="w-full border-stone-200 text-slate-600 rounded-md">
                    View All
                  </Button>
                </div>
              </CardContent>
            </Card>

          </div>
        </div>
      </main>
    </div>
  );
}
