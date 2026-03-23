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
  Menu,
  Bell,
  Search,
  ChevronLeft,
  MoreHorizontal,
  Clock
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

export function WarmRicherDepth() {
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
    <div className="min-h-screen bg-stone-50 text-slate-800 font-sans flex flex-col">
      {/* Very thin amber accent line at the very top */}
      <div className="h-0.5 bg-amber-400 w-full shrink-0 z-50"></div>
      
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside 
          className={`${
            sidebarOpen ? "w-64" : "w-20"
          } bg-gradient-to-b from-[#242b3d] to-[#1e2433] text-slate-300 transition-all duration-300 ease-in-out flex flex-col border-r border-[#151924] shadow-xl z-20 shrink-0`}
        >
          <div className="h-16 flex items-center px-4 border-b border-slate-700/50 justify-between">
            {sidebarOpen ? (
              <div className="flex items-center gap-2 overflow-hidden">
                <div className="w-8 h-8 rounded-md bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shrink-0 shadow-sm shadow-amber-900/40 border border-amber-300/20">
                  <Trophy className="w-5 h-5 text-amber-950" />
                </div>
                <span className="font-semibold text-lg tracking-tight text-white whitespace-nowrap">LeagueVault</span>
              </div>
            ) : (
              <div className="w-8 h-8 rounded-md bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shrink-0 mx-auto shadow-sm shadow-amber-900/40 border border-amber-300/20">
                <Trophy className="w-5 h-5 text-amber-950" />
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
                  } py-2.5 rounded-lg transition-colors group ${
                    item.current 
                      ? "bg-amber-500/10 text-amber-400 font-medium border border-amber-500/10" 
                      : "hover:bg-slate-800/80 hover:text-white border border-transparent"
                  }`}
                  title={!sidebarOpen ? item.name : undefined}
                >
                  <Icon className={`w-5 h-5 shrink-0 ${item.current ? "text-amber-500" : "text-slate-400 group-hover:text-slate-300"}`} />
                  {sidebarOpen && <span className="ml-3 truncate">{item.name}</span>}
                  {sidebarOpen && item.current && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="p-4 border-t border-slate-700/50 bg-[#1a1f2e]/50">
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-full flex items-center justify-center py-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition-colors"
            >
              {sidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {/* Header */}
          <header className="h-16 bg-white/80 backdrop-blur-md border-b border-stone-200/80 flex items-center justify-between px-6 shrink-0 sticky top-0 z-10 shadow-sm shadow-amber-900/5">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-slate-800 tracking-tight">Dashboard</h1>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="relative hidden md:block">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input 
                  type="text" 
                  placeholder="Search bowlers or leagues..." 
                  className="w-64 pl-9 bg-stone-50 border-stone-200 focus-visible:ring-amber-500 h-9 text-sm rounded-full"
                />
              </div>
              
              <button className="relative p-2 text-slate-400 hover:text-amber-600 transition-colors rounded-full hover:bg-amber-50">
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-500 rounded-full border border-white" />
              </button>
              
              <div className="h-6 w-px bg-stone-200 mx-1"></div>
              
              <button className="flex items-center gap-2 hover:bg-stone-50 p-1 pr-2 rounded-full transition-colors border border-transparent hover:border-stone-200">
                <Avatar className="w-8 h-8 border border-stone-200 shadow-sm">
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
                  <h2 className="text-2xl font-semibold text-slate-700 tracking-tight">Welcome back, John</h2>
                  <div className="flex items-center gap-3 mt-1.5">
                    <p className="text-slate-500 text-sm">Here's what's happening across your leagues today.</p>
                    <div className="hidden sm:flex items-center text-xs text-slate-400 bg-stone-100 px-2.5 py-1 rounded-full border border-stone-200/50">
                      <Clock className="w-3 h-3 mr-1.5" />
                      Last updated 5 min ago
                    </div>
                  </div>
                </div>
                <Button className="bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20 rounded-xl px-6 font-medium">
                  + New League
                </Button>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                <Card className="rounded-xl border-stone-200/60 shadow-md shadow-amber-900/5 hover:shadow-lg transition-all duration-300 bg-white overflow-hidden group">
                  <div className="h-1 w-full bg-slate-100 group-hover:bg-amber-400 transition-colors"></div>
                  <CardHeader className="flex flex-row items-center justify-between pb-2 pt-6">
                    <CardTitle className="text-sm font-medium text-slate-500">Active Leagues</CardTitle>
                    <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 ring-1 ring-inset ring-amber-500/20 shadow-inner">
                      <Trophy className="w-6 h-6" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-extrabold text-slate-800 tracking-tight">12</div>
                    <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center bg-emerald-50/50 w-fit px-2 py-0.5 rounded-md">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      +2 from last season
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-xl border-stone-200/60 shadow-md shadow-amber-900/5 hover:shadow-lg transition-all duration-300 bg-white overflow-hidden group">
                  <div className="h-1 w-full bg-slate-100 group-hover:bg-amber-400 transition-colors"></div>
                  <CardHeader className="flex flex-row items-center justify-between pb-2 pt-6">
                    <CardTitle className="text-sm font-medium text-slate-500">Active Bowlers</CardTitle>
                    <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 ring-1 ring-inset ring-amber-500/20 shadow-inner">
                      <Users className="w-6 h-6" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-extrabold text-slate-800 tracking-tight">148</div>
                    <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center bg-emerald-50/50 w-fit px-2 py-0.5 rounded-md">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      +15 new signups
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-xl border-stone-200/60 shadow-md shadow-amber-900/5 hover:shadow-lg transition-all duration-300 bg-white overflow-hidden group">
                  <div className="h-1 w-full bg-slate-100 group-hover:bg-teal-400 transition-colors"></div>
                  <CardHeader className="flex flex-row items-center justify-between pb-2 pt-6">
                    <CardTitle className="text-sm font-medium text-slate-500">Total Lineage Paid</CardTitle>
                    <div className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center text-teal-600 ring-1 ring-inset ring-teal-500/20 shadow-inner">
                      <TrendingUp className="w-6 h-6" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl text-slate-800 tracking-tight">
                      <span className="font-bold text-slate-400 text-3xl">$</span>
                      <span className="font-extrabold">24,850</span>
                    </div>
                    <p className="text-xs text-slate-500 font-medium mt-2">
                      Year to date
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-xl border-stone-200/60 shadow-md shadow-amber-900/5 hover:shadow-lg transition-all duration-300 bg-white overflow-hidden group">
                  <div className="h-1 w-full bg-slate-100 group-hover:bg-emerald-400 transition-colors"></div>
                  <CardHeader className="flex flex-row items-center justify-between pb-2 pt-6">
                    <CardTitle className="text-sm font-medium text-slate-500">Total Prize Fund</CardTitle>
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 ring-1 ring-inset ring-emerald-500/20 shadow-inner">
                      <DollarSign className="w-6 h-6" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl text-slate-800 tracking-tight">
                      <span className="font-bold text-slate-400 text-3xl">$</span>
                      <span className="font-extrabold">18,320</span>
                    </div>
                    <p className="text-xs text-slate-500 font-medium mt-2">
                      Projected final payout
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Past Due Bowlers Section */}
              <Card className="rounded-xl border-stone-200/60 border-l-4 border-l-amber-500 shadow-md shadow-amber-900/5 bg-white overflow-hidden">
                <CardHeader className="border-b border-stone-100 bg-stone-50/50 flex flex-row items-center justify-between py-6">
                  <div>
                    <CardTitle className="text-lg font-semibold text-slate-800">Action Required: Past Due Balances</CardTitle>
                    <CardDescription className="text-slate-500 mt-1.5">Bowlers who have missed payments across all active leagues.</CardDescription>
                  </div>
                  <Button variant="outline" className="border-stone-200 text-slate-600 hover:text-slate-800 hover:bg-stone-50 hidden sm:flex rounded-xl">
                    View All
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-stone-100/80 border-b-stone-200">
                      <TableRow className="border-stone-200 hover:bg-transparent">
                        <TableHead className="text-slate-600 font-medium py-4 pl-6 w-[280px]">Bowler Name</TableHead>
                        <TableHead className="text-slate-600 font-medium py-4">League</TableHead>
                        <TableHead className="text-slate-600 font-medium py-4">Status</TableHead>
                        <TableHead className="text-slate-600 font-medium py-4">Last Paid</TableHead>
                        <TableHead className="text-slate-600 font-medium text-right py-4">Amount Due</TableHead>
                        <TableHead className="text-right py-4 pr-6 w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pastDueBowlers.map((bowler, idx) => (
                        <TableRow 
                          key={bowler.id} 
                          className={`border-stone-100 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-stone-50/40'} hover:bg-stone-100/50`}
                        >
                          <TableCell className="font-medium text-slate-800 py-4 pl-6">
                            <div className="flex items-center gap-3">
                              <Avatar className="w-9 h-9 border border-stone-200 shadow-sm">
                                <AvatarFallback className="bg-amber-100 text-amber-700 text-xs font-semibold">
                                  {bowler.name.split(' ').map(n => n[0]).join('')}
                                </AvatarFallback>
                              </Avatar>
                              {bowler.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-slate-600 py-4">{bowler.league}</TableCell>
                          <TableCell className="py-4">
                            <Badge 
                              variant="secondary" 
                              className={`
                                rounded-full px-2.5 py-0.5
                                ${bowler.weeksOverdue > 2 
                                  ? 'bg-red-50 text-red-700 border-red-200/60' 
                                  : 'bg-amber-50 text-amber-700 border-amber-200/60'} 
                                font-medium shadow-sm border
                              `}
                            >
                              {bowler.weeksOverdue} {bowler.weeksOverdue === 1 ? 'week' : 'weeks'} overdue
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-500 text-sm py-4">{bowler.lastPaid}</TableCell>
                          <TableCell className="text-right py-4">
                            <span className="font-semibold text-slate-800">${bowler.amountDue.toFixed(2)}</span>
                          </TableCell>
                          <TableCell className="text-right py-4 pr-6">
                            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-full h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  
                  <div className="p-4 border-t border-stone-100 bg-stone-50/50 flex justify-center sm:hidden">
                    <Button variant="outline" className="w-full border-stone-200 text-slate-600 rounded-xl">
                      View All
                    </Button>
                  </div>
                </CardContent>
              </Card>

            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
