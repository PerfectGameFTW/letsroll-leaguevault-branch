import React, { useState } from "react";
import { 
  Trophy, 
  Users, 
  TrendingUp, 
  DollarSign, 
  Home, 
  Settings, 
  CreditCard, 
  Plug, 
  LayoutDashboard, 
  ChevronRight,
  Bell,
  Search,
  Menu,
  ChevronDown
} from "lucide-react";

export function PolishedPro() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const stats = [
    { label: "Active Leagues", value: "12", icon: Trophy, trend: "+2 this season" },
    { label: "Active Bowlers", value: "148", icon: Users, trend: "+14 this month" },
    { label: "Total Lineage Paid", value: "$24,850", icon: TrendingUp, trend: "98% collection rate" },
    { label: "Total Prize Fund", value: "$18,320", icon: DollarSign, trend: "On track" },
  ];

  const pastDueBowlers = [
    { id: 1, name: "John Smith", league: "Monday Night Men", amount: 45.00, weeks: 3 },
    { id: 2, name: "Sarah Johnson", league: "Mixed Trios", amount: 15.00, weeks: 1 },
    { id: 3, name: "Mike Davis", league: "Senior Scratch", amount: 60.00, weeks: 4 },
    { id: 4, name: "Emily Chen", league: "Thursday Mixed", amount: 30.00, weeks: 2 },
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
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex overflow-hidden selection:bg-indigo-100">
      
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
          <div className="flex items-center text-slate-500">
            <span className="text-sm font-medium">Dashboard</span>
            <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
            <span className="text-sm font-medium text-slate-900">Overview</span>
          </div>

          <div className="flex items-center gap-5">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
              <input 
                type="text" 
                placeholder="Search leagues or bowlers..." 
                className="pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all w-64"
              />
            </div>
            
            <button className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 border border-white"></span>
            </button>
            
            <div className="h-6 w-[1px] bg-slate-200"></div>
            
            <button className="flex items-center gap-2 hover:bg-slate-50 p-1 pr-2 rounded-full transition-colors border border-transparent hover:border-slate-200">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                AD
              </div>
              <ChevronDown className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto space-y-8">
            
            <div className="flex justify-between items-end">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back, Admin</h1>
                <p className="text-slate-500 mt-1">Here's what's happening with your leagues today.</p>
              </div>
              <button className="px-4 py-2 bg-[#0f172a] text-white text-sm font-medium rounded-md hover:bg-slate-800 transition-colors shadow-sm">
                Generate Report
              </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.map((stat, idx) => (
                <div 
                  key={idx} 
                  className="bg-white rounded-xl p-6 border border-slate-200 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 group flex flex-col justify-between h-40"
                >
                  <div className="flex justify-between items-start">
                    <span className="font-medium text-slate-500 text-sm">{stat.label}</span>
                    <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center group-hover:bg-indigo-50 group-hover:scale-110 transition-all duration-300">
                      <stat.icon className="w-5 h-5 text-slate-600 group-hover:text-indigo-600 transition-colors" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-slate-900 tracking-tight">{stat.value}</div>
                    <div className="text-xs font-medium text-emerald-600 mt-2 bg-emerald-50 inline-block px-2 py-1 rounded-md">
                      {stat.trend}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Past Due Section */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-white">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Past Due Bowlers</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Bowlers who are behind on their league fees.</p>
                </div>
                <button className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md">
                  View All
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Bowler</th>
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">League</th>
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount Due</th>
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Weeks Overdue</th>
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pastDueBowlers.map((bowler) => (
                      <tr key={bowler.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                              {bowler.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <span className="font-medium text-slate-900">{bowler.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                          {bowler.league}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-medium text-red-600">${bowler.amount.toFixed(2)}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            bowler.weeks > 2 ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'
                          }`}>
                            {bowler.weeks} {bowler.weeks === 1 ? 'week' : 'weeks'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <button className="text-indigo-600 hover:text-indigo-900 font-medium text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                            Send Reminder
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
