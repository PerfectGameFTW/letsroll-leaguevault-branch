import React, { useState } from "react";
import { 
  Trophy, 
  Users, 
  CreditCard, 
  Plug, 
  Settings,
  LayoutDashboard,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserPlus,
  FileText,
  Clock,
  Menu,
  Bell,
  Search,
  ChevronDown,
  ChevronRight,
  Send,
  User
} from "lucide-react";

export function ActivityFeed() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", active: true },
    { icon: Trophy, label: "Leagues", active: false },
    { icon: Users, label: "Bowlers", active: false },
    { icon: CreditCard, label: "Payments", active: false },
    { icon: Plug, label: "Integrations", active: false },
    { icon: Settings, label: "Settings", active: false },
  ];

  const stats = [
    { label: "Active Leagues", value: "12", icon: Trophy },
    { label: "Active Bowlers", value: "148", icon: Users },
    { label: "Total Lineage Paid", value: "$24,850", icon: CreditCard },
    { label: "Total Prize Fund", value: "$18,320", icon: Trophy },
  ];

  const pastDueBowlers = [
    { id: 1, name: "Sarah Jenkins", league: "Weekend Warriors", amount: 120.50, weeks: 4 },
    { id: 2, name: "Emily Chen", league: "Tuesday Night Trios", amount: 90.00, weeks: 3 },
    { id: 3, name: "Michael Chang", league: "Tuesday Night Trios", amount: 45.00, weeks: 2 },
    { id: 4, name: "David Rodriguez", league: "Friday Corporate League", amount: 30.00, weeks: 1 },
  ];

  const feedItems = [
    {
      id: 1,
      type: 'missed',
      title: "Sarah Jenkins missed payment",
      description: "$120.50 overdue (Weekend Warriors)",
      timestamp: "2h ago",
      icon: XCircle,
      iconColor: "text-red-500",
      iconBg: "bg-red-50",
      action: "Send Reminder"
    },
    {
      id: 2,
      type: 'success',
      title: "Michael Chang payment received",
      description: "$45.00 (Tuesday Night Trios)",
      timestamp: "4h ago",
      icon: CheckCircle2,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-50",
      action: "View Receipt"
    },
    {
      id: 3,
      type: 'info',
      title: "3 new bowlers registered",
      description: "Friday Corporate League",
      timestamp: "5h ago",
      icon: UserPlus,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-50",
      action: "View Roster"
    },
    {
      id: 4,
      type: 'success',
      title: "Season payment collected",
      description: "$2,450 — Tuesday Night Trios",
      timestamp: "Yesterday, 3:45 PM",
      icon: CheckCircle2,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-50"
    },
    {
      id: 5,
      type: 'warning',
      title: "Emily Chen — 3 weeks overdue",
      description: "$90 (Tuesday Night Trios)",
      timestamp: "Yesterday, 11:30 AM",
      icon: AlertTriangle,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-50",
      action: "Send Reminder"
    },
    {
      id: 6,
      type: 'neutral',
      title: "Weekly lineage report generated",
      description: "$1,240 collected",
      timestamp: "Yesterday, 9:00 AM",
      icon: FileText,
      iconColor: "text-slate-500",
      iconBg: "bg-slate-100",
      action: "Download"
    },
    {
      id: 7,
      type: 'info',
      title: "Roster updated",
      description: "2 bowlers added — Monday Senior League",
      timestamp: "Aug 14, 2:15 PM",
      icon: Users,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-50"
    }
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
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center text-slate-500">
            <span className="text-sm font-medium">Dashboard</span>
            <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
            <span className="text-sm font-medium text-slate-900">Activity</span>
          </div>

          <div className="flex items-center gap-5">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
              <input 
                type="text" 
                placeholder="Search activity..." 
                className="pl-9 pr-4 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all w-64"
              />
            </div>
            
            <button className="relative text-slate-400 hover:text-slate-600 transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white"></span>
            </button>
          </div>
        </header>

        {/* Top Stats Bar */}
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center flex-1 divide-x divide-slate-200">
            {stats.map((stat, idx) => (
              <div key={idx} className={`flex items-center gap-3 ${idx === 0 ? "pr-6" : "px-6"} ${idx === stats.length - 1 ? "border-r-0" : ""}`}>
                <div className="p-1.5 rounded bg-slate-50 text-slate-500">
                  <stat.icon className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{stat.label}</div>
                  <div className="text-lg font-bold text-slate-900 leading-tight">{stat.value}</div>
                </div>
              </div>
            ))}
          </div>
          <button className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-sm font-medium rounded-md transition-colors border border-indigo-100">
            View All Reports
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          
          {/* Main Feed Area */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            <div className="max-w-3xl mx-auto">
              <div className="mb-6 flex justify-between items-center">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Activity Feed</h1>
                <div className="flex items-center gap-2 text-sm text-slate-500 bg-white border border-slate-200 rounded-md px-3 py-1.5 shadow-sm">
                  <Clock className="w-4 h-4" />
                  <span>Real-time</span>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 ml-1 animate-pulse"></div>
                </div>
              </div>

              {/* Chronological Feed */}
              <div className="relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                <div className="space-y-6">
                  {feedItems.map((item, index) => (
                    <div key={item.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                      
                      {/* Timeline Icon */}
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-[#f8fafc] bg-white shadow-sm shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${item.iconBg} ${item.iconColor}`}>
                          <item.icon className="w-4 h-4" />
                        </div>
                      </div>
                      
                      {/* Card */}
                      <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-1">
                          <h3 className="font-semibold text-slate-900 text-sm">{item.title}</h3>
                          <span className="text-xs text-slate-400 font-medium shrink-0 ml-2">{item.timestamp}</span>
                        </div>
                        <p className="text-slate-600 text-sm">{item.description}</p>
                        
                        {item.action && (
                          <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
                            <button className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                              {item.action} &rarr;
                            </button>
                          </div>
                        )}
                      </div>

                    </div>
                  ))}
                </div>
                
                <div className="mt-8 text-center">
                  <button className="px-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shadow-sm">
                    Load Older Activity
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar: Needs Attention */}
          <div className="w-full md:w-80 bg-slate-50 border-l border-slate-200 overflow-y-auto shrink-0">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-6">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <h2 className="text-lg font-bold text-slate-900">Needs Attention</h2>
              </div>

              <div className="space-y-4">
                {pastDueBowlers.map((bowler) => (
                  <div key={bowler.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                          {bowler.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <h4 className="font-semibold text-slate-900 text-sm leading-tight">{bowler.name}</h4>
                          <span className="text-xs text-slate-500">{bowler.league}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-red-50 rounded-lg p-2.5 mb-3 flex justify-between items-center">
                      <div>
                        <div className="text-xs text-red-600 font-medium">Overdue</div>
                        <div className="text-sm font-bold text-red-700">${bowler.amount.toFixed(2)}</div>
                      </div>
                      <div className="text-xs bg-white px-2 py-1 rounded text-red-600 font-medium shadow-sm border border-red-100">
                        {bowler.weeks} {bowler.weeks === 1 ? 'week' : 'weeks'}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[#0f172a] hover:bg-slate-800 text-white text-xs font-medium rounded-md transition-colors">
                        <Send className="w-3 h-3" />
                        Remind
                      </button>
                      <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-medium rounded-md transition-colors">
                        <User className="w-3 h-3" />
                        Profile
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button className="w-full mt-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">
                View all past due (12)
              </button>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
