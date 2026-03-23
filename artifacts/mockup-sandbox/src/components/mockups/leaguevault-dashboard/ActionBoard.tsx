import React, { useState } from "react";
import { 
  Trophy, 
  Users, 
  TrendingUp, 
  DollarSign, 
  CreditCard, 
  Plug, 
  LayoutDashboard, 
  Settings,
  Search,
  Bell,
  ChevronDown,
  Menu,
  AlertCircle,
  Clock,
  CheckCircle2,
  Mail,
  MoreVertical,
  FileText,
  UserCog
} from "lucide-react";

export function ActionBoard() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const stats = [
    { label: "Active Leagues", value: "12", icon: Trophy, trend: "+2 this season" },
    { label: "Active Bowlers", value: "148", icon: Users, trend: "+14 this month" },
    { label: "Total Lineage Paid", value: "$24,850", icon: TrendingUp, trend: "98% collection rate" },
    { label: "Total Prize Fund", value: "$18,320", icon: DollarSign, trend: "On track" },
  ];

  const urgentItems = [
    { id: 1, name: "Sarah Jenkins", league: "Weekend Warriors", amount: 120.50, weeks: 4, type: "past-due" },
    { id: 2, name: "Emily Chen", league: "Tuesday Night Trios", amount: 90.00, weeks: 3, type: "past-due" },
  ];

  const thisWeekItems = [
    { id: 3, name: "Michael Chang", league: "Tuesday Night Trios", amount: 45.00, weeks: 2, type: "past-due" },
    { id: 4, name: "David Rodriguez", league: "Friday Corporate League", amount: 30.00, weeks: 1, type: "past-due" },
    { id: 5, title: "Generate weekly lineage report", type: "task", icon: FileText },
    { id: 6, title: "Review Weekend Warriors roster changes", type: "task", icon: UserCog },
  ];

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", active: true },
    { icon: Trophy, label: "Leagues", active: false },
    { icon: Users, label: "Bowlers", active: false },
    { icon: CreditCard, label: "Payments", active: false },
    { icon: Plug, label: "Integrations", active: false },
    { icon: Settings, label: "Settings", active: false },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex overflow-hidden selection:bg-indigo-100">
      
      {/* Sidebar */}
      <aside 
        className={`${sidebarOpen ? "w-64" : "w-20"} transition-all duration-300 ease-in-out bg-[#0f172a] text-slate-300 flex flex-col border-r border-slate-800 shadow-xl z-20 shrink-0`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60 bg-[#0f172a] shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-md bg-indigo-500 flex items-center justify-center shrink-0 shadow-sm">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            {sidebarOpen && <span className="font-semibold text-white tracking-tight text-lg whitespace-nowrap">LeagueVault</span>}
          </div>
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
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
                  ? "bg-indigo-500/10 text-indigo-400" 
                  : "hover:bg-slate-800 hover:text-white"
              }`}
            >
              <item.icon className={`w-5 h-5 shrink-0 ${item.active ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-300"}`} />
              {sidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
            </a>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center shrink-0 overflow-hidden">
              <span className="text-xs font-bold text-white">AD</span>
            </div>
            {sidebarOpen && (
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium text-white truncate">Admin User</span>
                <span className="text-xs text-slate-500 truncate">admin@leaguevault.com</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative z-10">
        
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)] z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-slate-900">Good morning, Admin</h1>
            <div className="px-3 py-1 bg-red-50 text-red-600 text-xs font-medium rounded-full border border-red-100 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>4 items need attention</span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
              <input 
                type="text" 
                placeholder="Search..." 
                className="pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all w-48"
              />
            </div>
            
            <button className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors">
              <Bell className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
          <div className="max-w-7xl mx-auto space-y-8">
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Left Column: Tasks & Actions */}
              <div className="lg:col-span-2 space-y-8">
                
                {/* Section 1: Urgent */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <AlertCircle className="w-5 h-5 text-red-500" />
                    <h2 className="text-lg font-bold text-slate-900">Urgent</h2>
                    <span className="text-sm text-slate-500 ml-2">Needs immediate attention</span>
                  </div>
                  
                  <div className="space-y-3">
                    {urgentItems.map((item) => (
                      <div key={item.id} className="bg-white border border-red-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500"></div>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-slate-900 text-lg">{item.name}</span>
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-md">
                                {item.weeks} weeks overdue
                              </span>
                            </div>
                            <div className="text-sm text-slate-600 flex items-center gap-2">
                              <span>{item.league}</span>
                              <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                              <span className="font-semibold text-red-600">${item.amount.toFixed(2)}</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            <button className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-md hover:bg-slate-50 transition-colors">
                              <Mail className="w-4 h-4 text-slate-400" />
                              Send Reminder
                            </button>
                            <button className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors shadow-sm">
                              <CreditCard className="w-4 h-4" />
                              Record Payment
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Section 2: This Week */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-5 h-5 text-amber-500" />
                    <h2 className="text-lg font-bold text-slate-900">This Week</h2>
                    <span className="text-sm text-slate-500 ml-2">Upcoming tasks & minor delays</span>
                  </div>
                  
                  <div className="space-y-3">
                    {thisWeekItems.map((item) => (
                      <div key={item.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm hover:shadow transition-shadow">
                        {item.type === 'past-due' ? (
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-sm shrink-0 border border-amber-100">
                                {item.name?.split(' ').map(n => n[0]).join('')}
                              </div>
                              <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="font-semibold text-slate-900">{item.name}</span>
                                  <span className="text-xs text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded">
                                    {item.weeks} {item.weeks === 1 ? 'week' : 'weeks'} late
                                  </span>
                                </div>
                                <div className="text-sm text-slate-500">
                                  {item.league} &bull; <span className="font-medium text-slate-700">${item.amount?.toFixed(2)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-md transition-colors" title="Send Reminder">
                                <Mail className="w-4 h-4" />
                              </button>
                              <button className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors" title="Record Payment">
                                <CreditCard className="w-4 h-4" />
                              </button>
                              <button className="p-1 text-slate-300 hover:text-slate-500 transition-colors">
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-md bg-slate-50 text-slate-500 flex items-center justify-center shrink-0 border border-slate-100">
                                {item.icon && <item.icon className="w-4 h-4" />}
                              </div>
                              <span className="font-medium text-slate-800">{item.title}</span>
                            </div>
                            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors">
                              Start
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

              </div>

              {/* Right Column: Overview Context */}
              <div className="space-y-6">
                
                {/* Section 3: Overview */}
                <section>
                  <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Overview</h2>
                  
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
                    <div className="mb-6">
                      <div className="flex justify-between items-end mb-2">
                        <span className="text-sm font-semibold text-slate-700">Season Progress</span>
                        <span className="text-xs font-medium text-slate-500">Week 18 of 32</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div className="bg-indigo-500 h-2 rounded-full" style={{ width: '56%' }}></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-end mb-2">
                        <span className="text-sm font-semibold text-slate-700">Collection Rate</span>
                        <span className="text-sm font-bold text-emerald-600">94%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '94%' }}></div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {stats.map((stat, idx) => (
                      <div key={idx} className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm">
                        <stat.icon className="w-4 h-4 text-slate-400 mb-2" />
                        <div className="text-lg font-bold text-slate-900">{stat.value}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </section>

              </div>
              
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
