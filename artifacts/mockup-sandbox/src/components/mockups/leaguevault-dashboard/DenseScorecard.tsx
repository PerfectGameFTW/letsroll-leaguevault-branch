import React from "react";
import { 
  LayoutDashboard, 
  Trophy, 
  Users, 
  CreditCard, 
  Plug, 
  Settings,
  TrendingUp,
  Activity,
  ArrowUpRight,
  ChevronRight,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";

export function DenseScorecard() {
  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", active: true },
    { icon: Trophy, label: "Leagues", active: false },
    { icon: Users, label: "Bowlers", active: false },
    { icon: CreditCard, label: "Payments", active: false },
    { icon: Plug, label: "Integrations", active: false },
    { icon: Settings, label: "Settings", active: false },
  ];

  const pastDue = [
    { name: "Sarah Jenkins", league: "Weekend Warriors", amount: 120.50, weeks: 4 },
    { name: "Emily Chen", league: "Tuesday Night Trios", amount: 90.00, weeks: 3 },
    { name: "Michael Chang", league: "Tuesday Night Trios", amount: 45.00, weeks: 2 },
    { name: "David Rodriguez", league: "Friday Corporate League", amount: 30.00, weeks: 1 },
  ];

  const totalPastDue = pastDue.reduce((sum, item) => sum + item.amount, 0);

  const leagueHealth = [
    { name: "Tuesday Night Trios", bowlers: 38, collection: 94, status: "amber" },
    { name: "Weekend Warriors", bowlers: 42, collection: 91, status: "red" },
    { name: "Friday Corporate", bowlers: 32, collection: 97, status: "amber" },
    { name: "Monday Senior", bowlers: 36, collection: 100, status: "green" },
  ];

  const weeklyCollections = [
    { week: "W11", amount: 2100 },
    { week: "W12", amount: 1950 },
    { week: "W13", amount: 2400 },
    { week: "W14", amount: 2200 },
    { week: "W15", amount: 1800 },
    { week: "W16", amount: 2600 },
    { week: "W17", amount: 2500 },
    { week: "W18", amount: 2850 },
  ];
  const maxCollection = Math.max(...weeklyCollections.map(w => w.amount));

  const recentActivity = [
    { text: "Payment: M. Chang — $45", icon: CheckCircle2, type: "success" },
    { text: "Overdue: S. Jenkins — $120.50", icon: AlertTriangle, type: "warning" },
    { text: "Payment: E. Chen — $90", icon: CheckCircle2, type: "success" },
    { text: "Payment: D. Rodriguez — $30", icon: CheckCircle2, type: "success" },
    { text: "New Bowler: A. Smith — Registered", icon: Users, type: "info" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex overflow-hidden">
      {/* Sidebar: Compact, Icon-only */}
      <aside className="w-16 bg-[#0f172a] flex flex-col items-center py-4 border-r border-slate-800 z-20 shrink-0 shadow-lg">
        <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center mb-8">
          <Trophy className="w-5 h-5 text-indigo-400" />
        </div>
        <nav className="flex-1 flex flex-col gap-4 w-full px-2">
          {navItems.map((item, idx) => (
            <button 
              key={idx}
              title={item.label}
              className={`w-full aspect-square rounded-md flex items-center justify-center transition-colors group ${
                item.active 
                  ? "bg-indigo-500/10 text-indigo-400" 
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              <item.icon className="w-5 h-5" />
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Minimal Header */}
        <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center gap-4">
            <span className="font-bold text-slate-800 tracking-tight">LeagueVault</span>
            <span className="text-slate-300">|</span>
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{currentDate}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center overflow-hidden">
              <span className="text-[10px] font-bold text-slate-600">AD</span>
            </div>
          </div>
        </header>

        {/* Main Content: Dense Grid */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50/50">
          <div className="max-w-7xl mx-auto flex flex-col gap-4">
            
            {/* Top Row: Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Active Leagues</div>
                <div className="flex items-end justify-between">
                  <div className="text-xl font-bold text-slate-900">12</div>
                  <Activity className="w-3.5 h-3.5 text-emerald-500 mb-1" />
                </div>
              </div>
              <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Active Bowlers</div>
                <div className="flex items-end justify-between">
                  <div className="text-xl font-bold text-slate-900">148</div>
                  <div className="text-xs font-medium text-emerald-600 flex items-center">
                    <ArrowUpRight className="w-3 h-3 mr-0.5" /> 14
                  </div>
                </div>
              </div>
              <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Lineage Collected</div>
                <div className="flex items-end justify-between">
                  <div className="text-xl font-bold text-slate-900">$24,850</div>
                  <div className="text-[10px] text-slate-400 font-medium">85% of target</div>
                </div>
              </div>
              <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Prize Fund</div>
                <div className="flex items-end justify-between">
                  <div className="text-xl font-bold text-slate-900">$18,320</div>
                </div>
              </div>
              <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Collection Rate</div>
                  <div className="text-xl font-bold text-slate-900">94%</div>
                </div>
                <div className="relative w-8 h-8">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path className="text-slate-100" strokeWidth="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path className="text-indigo-500" strokeDasharray="94, 100" strokeWidth="4" stroke="currentColor" fill="none" strokeLinecap="round" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  </svg>
                </div>
              </div>
              <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-sm flex flex-col justify-center">
                <div className="flex justify-between items-end mb-1.5">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Season</div>
                  <div className="text-xs font-bold text-slate-700">Wk 18/32</div>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-slate-800 rounded-full" style={{ width: `${(18/32)*100}%` }}></div>
                </div>
              </div>
            </div>

            {/* Middle Section: 2 Columns */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              
              {/* Past Due Summary */}
              <div className="lg:col-span-3 flex flex-col">
                <div className="flex justify-between items-center mb-2 px-1">
                  <h3 className="text-sm font-bold text-slate-800">Past Due Summary</h3>
                  <div className="text-sm font-bold text-red-600">${totalPastDue.toFixed(2)} outstanding</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex-1 shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="py-2 px-3 font-semibold text-slate-500 text-xs uppercase tracking-wider w-1/3">Bowler</th>
                        <th className="py-2 px-3 font-semibold text-slate-500 text-xs uppercase tracking-wider w-1/3">League</th>
                        <th className="py-2 px-3 font-semibold text-slate-500 text-xs uppercase tracking-wider">Amount</th>
                        <th className="py-2 px-3 font-semibold text-slate-500 text-xs uppercase tracking-wider">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pastDue.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 group">
                          <td className="py-1.5 px-3 whitespace-nowrap relative">
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.weeks >= 3 ? 'bg-red-500' : 'bg-amber-400'}`}></div>
                            <span className="font-medium text-slate-900 ml-1">{item.name}</span>
                          </td>
                          <td className="py-1.5 px-3 whitespace-nowrap text-slate-600 text-xs truncate max-w-[120px]">{item.league}</td>
                          <td className="py-1.5 px-3 whitespace-nowrap font-medium text-slate-800">${item.amount.toFixed(2)}</td>
                          <td className="py-1.5 px-3 whitespace-nowrap">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              item.weeks >= 3 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                            }`}>
                              {item.weeks}w
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* League Health Grid */}
              <div className="lg:col-span-2 flex flex-col">
                <div className="flex justify-between items-center mb-2 px-1">
                  <h3 className="text-sm font-bold text-slate-800">League Health</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 flex-1">
                  {leagueHealth.map((league, idx) => (
                    <div key={idx} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex flex-col justify-between">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-semibold text-slate-800 text-xs leading-tight pr-2">{league.name}</div>
                        <div className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${
                          league.status === 'green' ? 'bg-emerald-500' : 
                          league.status === 'amber' ? 'bg-amber-400' : 'bg-red-500'
                        }`}></div>
                      </div>
                      <div className="flex justify-between items-end mt-auto">
                        <div className="text-[10px] text-slate-500"><span className="font-bold text-slate-700">{league.bowlers}</span> bwlrs</div>
                        <div className="text-xs font-bold text-slate-900">{league.collection}%</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Row: Trends */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
              
              {/* Weekly Collections */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4">Weekly Collections</h3>
                <div className="flex items-end gap-2 h-24 mt-2">
                  {weeklyCollections.map((col, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1 group">
                      <div className="w-full relative flex items-end justify-center h-full bg-slate-50 rounded-sm overflow-hidden">
                        <div 
                          className="w-full bg-indigo-500/80 group-hover:bg-indigo-600 transition-colors rounded-t-sm" 
                          style={{ height: `${(col.amount / maxCollection) * 100}%` }}
                        ></div>
                      </div>
                      <div className="text-[9px] font-medium text-slate-400">{col.week}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Recent Activity</h3>
                  <button className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800 flex items-center">
                    All <ChevronRight className="w-3 h-3 ml-0.5" />
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {recentActivity.map((activity, idx) => (
                    <div key={idx} className="flex items-center gap-2 py-1 border-b border-slate-50 last:border-0">
                      <activity.icon className={`w-3.5 h-3.5 shrink-0 ${
                        activity.type === 'success' ? 'text-emerald-500' :
                        activity.type === 'warning' ? 'text-amber-500' : 'text-blue-500'
                      }`} />
                      <span className="text-xs font-medium text-slate-700 truncate">{activity.text}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
