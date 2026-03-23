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
  Menu,
  Bell,
  Search,
  ChevronLeft,
  ChevronRight,
  User,
  LogOut,
  AlertCircle
} from "lucide-react";

export function MidnightClub() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("Dashboard");

  const navItems = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Leagues", icon: Trophy },
    { name: "Bowlers", icon: Users },
    { name: "Payments", icon: CreditCard },
    { name: "Integrations", icon: Plug },
    { name: "Settings", icon: Settings },
  ];

  const stats = [
    { name: "Active Leagues", value: "12", icon: Trophy, trend: "+2 this season" },
    { name: "Active Bowlers", value: "148", icon: Users, trend: "+12 this month" },
    { name: "Total Lineage Paid", value: "$24,850", icon: TrendingUp, trend: "On track" },
    { name: "Total Prize Fund", value: "$18,320", icon: DollarSign, trend: "+$2.4k vs last year" },
  ];

  const pastDueBowlers = [
    { id: 1, name: "Marcus Johnson", league: "Tuesday Night Rollers", amount: "$45.00", weeks: 3 },
    { id: 2, name: "Sarah Williams", league: "Weekend Warriors", amount: "$30.00", weeks: 2 },
    { id: 3, name: "David Chen", league: "Corporate League", amount: "$60.00", weeks: 4 },
    { id: 4, name: "Emily Rodriguez", league: "Tuesday Night Rollers", amount: "$15.00", weeks: 1 },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 overflow-hidden flex">
      {/* Sidebar */}
      <aside 
        className={`${
          sidebarOpen ? "w-64" : "w-20"
        } flex-shrink-0 transition-all duration-300 ease-in-out bg-slate-950 border-r border-slate-800/60 flex flex-col relative z-20 shadow-2xl`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60 bg-slate-950/50 backdrop-blur-md">
          {sidebarOpen ? (
            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.3)]">
                <Trophy size={18} className="text-white" />
              </div>
              <span className="font-bold text-lg tracking-wide text-white">LeagueVault</span>
            </div>
          ) : (
            <div className="w-8 h-8 mx-auto rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.3)]">
              <Trophy size={18} className="text-white" />
            </div>
          )}
          
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="absolute -right-3 top-5 w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:border-cyan-500/50 hover:bg-slate-900 transition-colors z-30"
          >
            {sidebarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.name;
            return (
              <button
                key={item.name}
                onClick={() => setActiveTab(item.name)}
                className={`w-full flex items-center ${
                  sidebarOpen ? "justify-start px-3" : "justify-center"
                } h-11 rounded-lg transition-all duration-200 group relative overflow-hidden ${
                  isActive 
                    ? "text-cyan-400 bg-cyan-950/30 border border-cyan-500/20 shadow-[inset_0_0_20px_rgba(34,211,238,0.05)]" 
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50 border border-transparent"
                }`}
                title={!sidebarOpen ? item.name : undefined}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-cyan-400 rounded-r-full shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
                )}
                <item.icon 
                  size={20} 
                  className={`flex-shrink-0 transition-colors ${
                    isActive ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300"
                  }`} 
                />
                {sidebarOpen && (
                  <span className={`ml-3 font-medium transition-colors ${isActive ? "text-cyan-50" : ""}`}>
                    {item.name}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-slate-800/60 bg-slate-950">
          <button className={`w-full flex items-center ${sidebarOpen ? "justify-start px-2" : "justify-center"} h-10 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition-colors`}>
            <LogOut size={18} />
            {sidebarOpen && <span className="ml-3 text-sm">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950">
        
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-slate-800/40 bg-slate-950/80 backdrop-blur-sm z-10">
          <div className="flex items-center bg-slate-900/50 border border-slate-800/80 rounded-full px-4 py-1.5 w-64 focus-within:ring-1 focus-within:ring-cyan-500/50 focus-within:border-cyan-500/30 transition-all">
            <Search size={16} className="text-slate-500 mr-2" />
            <input 
              type="text" 
              placeholder="Search bowlers, leagues..." 
              className="bg-transparent border-none outline-none text-sm text-slate-200 placeholder:text-slate-600 w-full"
            />
          </div>

          <div className="flex items-center gap-5">
            <button className="relative text-slate-400 hover:text-cyan-400 transition-colors">
              <Bell size={20} />
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(34,211,238,0.8)]"></span>
            </button>
            
            <div className="h-6 w-px bg-slate-800"></div>
            
            <div className="flex items-center gap-3 cursor-pointer group">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">Admin User</p>
                <p className="text-xs text-slate-500">Manager</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden ring-2 ring-transparent group-hover:ring-cyan-500/30 transition-all">
                <User size={18} className="text-slate-400" />
              </div>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-auto p-8 no-scrollbar">
          <div className="max-w-6xl mx-auto space-y-8">
            
            {/* Page Title */}
            <div className="flex items-end justify-between">
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight drop-shadow-md">
                  Dashboard
                </h1>
                <p className="text-slate-400 mt-1 flex items-center gap-2 text-sm">
                  Welcome back to LeagueVault. <span className="text-cyan-400/80">Here's your alley's status today.</span>
                </p>
              </div>
              
              <button className="h-10 px-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium shadow-[0_0_20px_rgba(8,145,178,0.3)] hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] transition-all flex items-center gap-2">
                <span>New League</span>
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.map((stat, i) => (
                <div 
                  key={i} 
                  className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 relative overflow-hidden group hover:border-cyan-500/30 transition-all duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-cyan-500/10 transition-colors"></div>
                  
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <p className="text-sm font-medium text-slate-400">{stat.name}</p>
                    <div className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center group-hover:border-cyan-500/30 transition-colors group-hover:text-cyan-400 text-slate-500">
                      <stat.icon size={16} />
                    </div>
                  </div>
                  
                  <div className="relative z-10">
                    <h3 className="text-3xl font-bold text-white tracking-tight">
                      {stat.value}
                    </h3>
                    <p className="text-xs text-cyan-400/80 mt-2 font-medium">
                      {stat.trend}
                    </p>
                  </div>
                  
                  {/* Subtle bottom glow effect on hover */}
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/0 to-transparent group-hover:via-cyan-500/50 transition-all duration-500"></div>
                </div>
              ))}
            </div>

            {/* Past Due Bowlers Section */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                  <AlertCircle size={18} className="text-rose-400" />
                  Past Due Bowlers
                </h2>
                <button className="text-sm text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
                  View All Actions
                </button>
              </div>
              
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-lg backdrop-blur-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/50">
                        <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Bowler Name</th>
                        <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">League</th>
                        <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Amount Due</th>
                        <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                        <th className="py-4 px-6 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {pastDueBowlers.map((bowler, i) => (
                        <tr 
                          key={bowler.id} 
                          className="hover:bg-slate-800/30 transition-colors group"
                        >
                          <td className="py-4 px-6 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 border border-slate-700">
                                {bowler.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              <span className="font-medium text-slate-200 group-hover:text-white transition-colors">{bowler.name}</span>
                            </div>
                          </td>
                          <td className="py-4 px-6 whitespace-nowrap text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                            {bowler.league}
                          </td>
                          <td className="py-4 px-6 whitespace-nowrap">
                            <span className="font-semibold text-rose-400/90">{bowler.amount}</span>
                          </td>
                          <td className="py-4 px-6 whitespace-nowrap">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              {bowler.weeks} {bowler.weeks === 1 ? 'week' : 'weeks'} overdue
                            </span>
                          </td>
                          <td className="py-4 px-6 whitespace-nowrap text-right">
                            <button className="text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white px-3 py-1.5 rounded-md border border-slate-700 transition-all">
                              Notify
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
        </div>
      </main>
    </div>
  );
}
