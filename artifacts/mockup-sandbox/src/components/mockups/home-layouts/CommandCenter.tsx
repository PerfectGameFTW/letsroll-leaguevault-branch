import React from "react";
import "./_group.css";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../ui/card";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  Trophy,
  Users,
  TrendingUp,
  DollarSign,
  AlertCircle,
  ChevronRight,
  LayoutDashboard,
  Settings,
  LogOut,
  Bell
} from "lucide-react";

export default function CommandCenter() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-slate-900">
      {/* Top Navbar */}
      <header className="bg-primary text-primary-foreground h-16 flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="bg-white/10 p-2 rounded-lg">
            <Trophy className="w-5 h-5 text-blue-200" />
          </div>
          <span className="font-semibold tracking-tight text-lg">LeagueVault</span>
        </div>
        
        <nav className="flex items-center gap-6 text-sm font-medium text-blue-100">
          <a href="#" className="text-white flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-md">
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </a>
          <a href="#" className="hover:text-white transition-colors flex items-center gap-2">
            <Users className="w-4 h-4" />
            Bowlers
          </a>
          <a href="#" className="hover:text-white transition-colors flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            Finances
          </a>
        </nav>

        <div className="flex items-center gap-4">
          <button className="relative p-2 hover:bg-white/10 rounded-full transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full"></span>
          </button>
          <div className="w-8 h-8 rounded-full bg-blue-800 border border-blue-600 flex items-center justify-center font-bold text-sm">
            JD
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-6 gap-6 max-w-[1600px] w-full mx-auto">
        
        {/* Top Stat Strip - 4 Cards Horizontal */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
          <Card className="border-none shadow-sm flex flex-col justify-center h-24">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="bg-blue-50 p-3 rounded-lg">
                <Trophy className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Leagues</p>
                <p className="text-2xl font-bold text-slate-900">5</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm flex flex-col justify-center h-24">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="bg-emerald-50 p-3 rounded-lg">
                <Users className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Bowlers</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-slate-900">42</p>
                  <span className="text-xs font-medium text-emerald-600 flex items-center">
                    <TrendingUp className="w-3 h-3 mr-1" /> +3
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm flex flex-col justify-center h-24">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="bg-amber-50 p-3 rounded-lg">
                <DollarSign className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Lineage Paid</p>
                <p className="text-2xl font-bold text-slate-900">$12,450</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm flex flex-col justify-center h-24">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="bg-purple-50 p-3 rounded-lg">
                <Trophy className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Prize Fund</p>
                <p className="text-2xl font-bold text-slate-900">$6,225</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Lower Split Area */}
        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-[500px]">
          
          {/* Left: 2/3 Chart Area */}
          <Card className="flex-[2] border-none shadow-sm flex flex-col">
            <CardHeader className="pb-2 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg text-slate-900">Payment Distribution</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">Season overview of collected vs outstanding dues</p>
                </div>
                <select className="text-sm border rounded-md px-3 py-1.5 bg-gray-50 text-slate-700 font-medium">
                  <option>Current Season</option>
                  <option>Last Season</option>
                </select>
              </div>
            </CardHeader>
            <CardContent className="p-8 flex-1 flex flex-col justify-center">
              
              <div className="max-w-3xl w-full mx-auto space-y-8">
                {/* Visual Bar representing the breakdown */}
                <div className="space-y-4">
                  <div className="flex justify-between items-end mb-2">
                    <div className="space-y-1">
                      <p className="text-3xl font-bold text-slate-900">$18,675</p>
                      <p className="text-sm font-medium text-muted-foreground">Total Expected Revenue</p>
                    </div>
                  </div>

                  {/* The Bar */}
                  <div className="h-8 w-full flex rounded-lg overflow-hidden ring-1 ring-inset ring-black/5">
                    <div className="bg-emerald-500 h-full transition-all duration-500" style={{ width: '75%' }} title="Paid (75%)"></div>
                    <div className="bg-amber-400 h-full transition-all duration-500" style={{ width: '15%' }} title="Pending (15%)"></div>
                    <div className="bg-rose-500 h-full transition-all duration-500" style={{ width: '10%' }} title="Overdue (10%)"></div>
                  </div>
                </div>

                {/* Legend & Details Grid */}
                <div className="grid grid-cols-3 gap-6 pt-6 border-t">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                      <span className="text-sm font-medium text-slate-600">Paid in Full</span>
                    </div>
                    <p className="text-xl font-bold text-slate-900">$14,006</p>
                    <p className="text-xs text-muted-foreground">75% of total</p>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                      <span className="text-sm font-medium text-slate-600">Pending</span>
                    </div>
                    <p className="text-xl font-bold text-slate-900">$2,801</p>
                    <p className="text-xs text-muted-foreground">15% of total</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-rose-500"></div>
                      <span className="text-sm font-medium text-slate-600">Overdue</span>
                    </div>
                    <p className="text-xl font-bold text-rose-600">$1,868</p>
                    <p className="text-xs text-rose-600/70">10% of total</p>
                  </div>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Right: 1/3 Past Due Sidebar */}
          <Card className="flex-[1] border-none shadow-sm flex flex-col bg-white">
            <CardHeader className="pb-4 border-b bg-rose-50/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-rose-500" />
                  <CardTitle className="text-lg text-slate-900">Action Required</CardTitle>
                </div>
                <Badge variant="destructive" className="bg-rose-500">5 Bowlers</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-y-auto">
              <div className="divide-y">
                
                {/* Bowler Item */}
                <div className="p-4 hover:bg-slate-50 transition-colors group flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-sm ring-1 ring-slate-200">
                      MJ
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-slate-900">Mike Johnson</p>
                      <p className="text-xs text-muted-foreground">Tuesday Night Mixed</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div className="space-y-0.5">
                      <p className="font-bold text-rose-600">$135.00</p>
                      <p className="text-[10px] font-medium text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">3 weeks late</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-1 transition-all">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Bowler Item */}
                <div className="p-4 hover:bg-slate-50 transition-colors group flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-sm ring-1 ring-slate-200">
                      SD
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-slate-900">Sarah Davis</p>
                      <p className="text-xs text-muted-foreground">Thursday Trios</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div className="space-y-0.5">
                      <p className="font-bold text-rose-600">$90.00</p>
                      <p className="text-[10px] font-medium text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">2 weeks late</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-1 transition-all">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Bowler Item */}
                <div className="p-4 hover:bg-slate-50 transition-colors group flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-sm ring-1 ring-slate-200">
                      RT
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-slate-900">Robert Taylor</p>
                      <p className="text-xs text-muted-foreground">Tuesday Night Mixed</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div className="space-y-0.5">
                      <p className="font-bold text-rose-600">$45.00</p>
                      <p className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">1 week late</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-1 transition-all">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Bowler Item */}
                <div className="p-4 hover:bg-slate-50 transition-colors group flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-sm ring-1 ring-slate-200">
                      AM
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-slate-900">Amanda Miller</p>
                      <p className="text-xs text-muted-foreground">Sunday Sweepers</p>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div className="space-y-0.5">
                      <p className="font-bold text-rose-600">$45.00</p>
                      <p className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">1 week late</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-1 transition-all">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

              </div>
            </CardContent>
            <div className="p-4 border-t bg-slate-50 rounded-b-xl mt-auto">
              <Button variant="outline" className="w-full bg-white text-slate-700 shadow-sm">
                View All Past Due Accounts
              </Button>
            </div>
          </Card>

        </div>
      </main>
    </div>
  );
}
