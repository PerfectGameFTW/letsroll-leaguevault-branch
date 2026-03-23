import React, { useState } from "react";
import { 
  Trophy, 
  Users, 
  CreditCard, 
  Plug, 
  LayoutDashboard, 
  Settings,
  Search,
  Bell,
  ChevronDown,
  Menu,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  MoreVertical,
  Activity
} from "lucide-react";

export function LeagueCentric() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", active: true },
    { icon: Trophy, label: "Leagues", active: false },
    { icon: Users, label: "Bowlers", active: false },
    { icon: CreditCard, label: "Payments", active: false },
    { icon: Plug, label: "Integrations", active: false },
    { icon: Settings, label: "Settings", active: false },
  ];

  const leagues = [
    {
      id: 1,
      name: "Tuesday Night Trios",
      status: "Active",
      tag: "In Season",
      bowlers: 38,
      lineage: 6200,
      prizeFund: 4800,
      collected: 96,
      currentWeek: 18,
      totalWeeks: 32,
      pastDue: [
        { name: "Michael Chang", amount: 45, weeks: 2 },
        { name: "Emily Chen", amount: 90, weeks: 3 }
      ]
    },
    {
      id: 2,
      name: "Weekend Warriors",
      status: "Active",
      tag: "In Season",
      bowlers: 42,
      lineage: 8100,
      prizeFund: 6500,
      collected: 92,
      currentWeek: 22,
      totalWeeks: 36,
      pastDue: [
        { name: "Sarah Jenkins", amount: 120.50, weeks: 4, critical: true }
      ]
    },
    {
      id: 3,
      name: "Friday Corporate League",
      status: "Active",
      tag: "In Season",
      bowlers: 32,
      lineage: 5400,
      prizeFund: 3200,
      collected: 98,
      currentWeek: 12,
      totalWeeks: 24,
      pastDue: [
        { name: "David Rodriguez", amount: 30, weeks: 1 }
      ]
    },
    {
      id: 4,
      name: "Monday Senior League",
      status: "Active",
      tag: "In Season",
      bowlers: 36,
      lineage: 5150,
      prizeFund: 3820,
      collected: 100,
      currentWeek: 14,
      totalWeeks: 30,
      pastDue: []
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex overflow-hidden selection:bg-blue-100">
      
      {/* Sidebar */}
      <aside 
        className={`${sidebarOpen ? "w-64" : "w-20"} transition-all duration-300 ease-in-out bg-[#0f172a] text-slate-300 flex flex-col border-r border-slate-800 shadow-xl z-20 shrink-0`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center shrink-0 shadow-sm">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            {sidebarOpen && <span className="font-semibold text-white tracking-tight text-lg whitespace-nowrap">LeagueVault</span>}
          </div>
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-6 px-3 flex flex-col gap-1.5 overflow-y-auto">
          {navItems.map((item, idx) => (
            <a 
              key={idx}
              href="#"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 group ${
                item.active 
                  ? "bg-blue-600/10 text-blue-400" 
                  : "hover:bg-slate-800 hover:text-white"
              }`}
            >
              <item.icon className={`w-5 h-5 shrink-0 ${item.active ? "text-blue-400" : "text-slate-400 group-hover:text-slate-300"}`} />
              {sidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
            </a>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
              <span className="text-xs font-bold text-white">AD</span>
            </div>
            {sidebarOpen && (
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium text-white truncate">Admin User</span>
                <span className="text-xs text-slate-500 truncate">Secretary</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative z-10">
        
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10">
          <div className="flex items-center text-slate-500">
            <span className="text-sm font-medium">Dashboard</span>
            <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
            <span className="text-sm font-medium text-slate-900">Your Leagues</span>
          </div>

          <div className="flex items-center gap-5">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
              <input 
                type="text" 
                placeholder="Find a league or bowler..." 
                className="pl-9 pr-4 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all w-64"
              />
            </div>
            
            <button className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 border border-white"></span>
            </button>
            
            <div className="h-6 w-[1px] bg-slate-200"></div>
            
            <button className="flex items-center gap-2 hover:bg-slate-50 p-1 pr-2 rounded-full transition-colors border border-transparent hover:border-slate-200">
              <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-sm border border-blue-100">
                AD
              </div>
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-5xl mx-auto space-y-6">
            
            {/* Page Title & Aggregate Summary */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-slate-200/60">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Your Leagues</h1>
                <div className="flex items-center gap-2 mt-2 text-sm text-slate-600 font-medium">
                  <Activity className="w-4 h-4 text-blue-500" />
                  <span>12 active leagues</span>
                  <span className="text-slate-300">•</span>
                  <span>148 bowlers</span>
                  <span className="text-slate-300">•</span>
                  <span className="text-emerald-600">94% collection rate</span>
                </div>
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors shadow-sm self-start md:self-auto">
                Add League
              </button>
            </div>

            {/* Leagues Stack */}
            <div className="space-y-4">
              {leagues.map((league) => (
                <div 
                  key={league.id} 
                  className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 group overflow-hidden cursor-pointer flex flex-col"
                >
                  <div className="p-5 flex flex-col md:flex-row md:items-center gap-4">
                    
                    {/* League Info & Badges */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1.5">
                        <h2 className="text-lg font-bold text-slate-900 group-hover:text-blue-700 transition-colors">{league.name}</h2>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                          {league.status}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          {league.tag}
                        </span>
                      </div>
                      
                      {/* Inline Metrics Row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-slate-400" />
                          <span className="font-medium text-slate-700">{league.bowlers}</span> bowlers
                        </div>
                        <div className="w-1 h-1 rounded-full bg-slate-300"></div>
                        <div>
                          <span className="font-medium text-slate-700">${league.lineage.toLocaleString()}</span> lineage
                        </div>
                        <div className="w-1 h-1 rounded-full bg-slate-300"></div>
                        <div>
                          <span className="font-medium text-slate-700">${league.prizeFund.toLocaleString()}</span> prize fund
                        </div>
                        <div className="w-1 h-1 rounded-full bg-slate-300"></div>
                        <div>
                          <span className="font-medium text-slate-700">{league.collected}%</span> collected
                        </div>
                      </div>
                    </div>

                    {/* Progress & Actions */}
                    <div className="flex items-center gap-6 md:w-64 shrink-0">
                      <div className="flex-1">
                        <div className="flex justify-between text-xs font-medium mb-1.5">
                          <span className="text-slate-500">Season Progress</span>
                          <span className="text-slate-700">Wk {league.currentWeek}/{league.totalWeeks}</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div 
                            className="bg-blue-500 h-2 rounded-full" 
                            style={{ width: `${(league.currentWeek / league.totalWeeks) * 100}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100">
                          <MoreVertical className="w-5 h-5" />
                        </button>
                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors" />
                      </div>
                    </div>
                  </div>

                  {/* Warning Strip for Past Due */}
                  {league.pastDue.length > 0 ? (
                    <div className={`px-5 py-3 border-t flex items-center justify-between ${
                      league.pastDue.some(p => p.critical) 
                        ? "bg-rose-50 border-rose-100" 
                        : "bg-amber-50/50 border-amber-100/50"
                    }`}>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`w-4 h-4 ${
                          league.pastDue.some(p => p.critical) ? "text-rose-600" : "text-amber-500"
                        }`} />
                        <span className={`text-sm font-medium ${
                          league.pastDue.some(p => p.critical) ? "text-rose-800" : "text-amber-800"
                        }`}>
                          {league.pastDue.length} {league.pastDue.length === 1 ? 'bowler' : 'bowlers'} past due:{" "}
                          <span className="font-normal opacity-90">
                            {league.pastDue.map((p, i) => (
                              <React.Fragment key={i}>
                                {i > 0 && ", "}
                                {p.name} (${p.amount.toFixed(2)}{p.critical && <span className="font-semibold text-rose-700 ml-1">— {p.weeks} wks</span>})
                              </React.Fragment>
                            ))}
                          </span>
                        </span>
                      </div>
                      <button className={`text-sm font-medium hover:underline ${
                        league.pastDue.some(p => p.critical) ? "text-rose-700" : "text-amber-700"
                      }`}>
                        View Details
                      </button>
                    </div>
                  ) : (
                    <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-xs font-medium text-emerald-700">All bowlers paid current</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
