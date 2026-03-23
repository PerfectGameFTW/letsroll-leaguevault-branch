import { useState } from "react";
import {
  Trophy,
  Users,
  TrendingUp,
  CreditCard,
  Plug,
  Settings,
  LayoutDashboard,
  ChevronRight,
  Bell,
  Search,
  Menu,
  ChevronDown,
  Activity,
  ArrowUpRight,
  DollarSign,
} from "lucide-react";

export function HybridDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
    { name: "Tuesday Night Trios", bowlers: 38, collection: 94, status: "amber" as const },
    { name: "Weekend Warriors", bowlers: 42, collection: 91, status: "red" as const },
    { name: "Friday Corporate", bowlers: 32, collection: 97, status: "amber" as const },
    { name: "Monday Senior", bowlers: 36, collection: 100, status: "green" as const },
  ];

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans flex overflow-hidden">
      <aside
        className={`${sidebarOpen ? "w-64" : "w-20"} transition-all duration-300 ease-in-out bg-[#0f172a] text-slate-300 flex flex-col border-r border-slate-800 shadow-xl z-20 shrink-0`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/60 shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-md bg-indigo-500 flex items-center justify-center shrink-0 shadow-sm">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            {sidebarOpen && (
              <span className="font-semibold text-white tracking-tight text-lg whitespace-nowrap">
                LeagueVault
              </span>
            )}
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
              <item.icon
                className={`w-5 h-5 shrink-0 ${
                  item.active ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-300"
                }`}
              />
              {sidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
            </a>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center shrink-0">
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

      <main className="flex-1 flex flex-col h-screen overflow-hidden relative z-10">
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
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 border border-white" />
            </button>

            <div className="h-6 w-[1px] bg-slate-200" />

            <button className="flex items-center gap-2 hover:bg-slate-50 p-1 pr-2 rounded-full transition-colors border border-transparent hover:border-slate-200">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">
                AD
              </div>
              <ChevronDown className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-6xl mx-auto flex flex-col gap-6">
            <div className="flex justify-between items-end">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  Welcome back, Admin
                </h1>
                <p className="text-slate-500 mt-1">
                  Here's what's happening with your leagues today.
                </p>
              </div>
              <button className="px-4 py-2 bg-[#0f172a] text-white text-sm font-medium rounded-md hover:bg-slate-800 transition-colors shadow-sm">
                Generate Report
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Active Leagues
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold text-slate-900">12</div>
                  <Activity className="w-3.5 h-3.5 text-emerald-500 mb-1" />
                </div>
              </div>
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Active Bowlers
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold text-slate-900">148</div>
                  <div className="text-xs font-medium text-emerald-600 flex items-center">
                    <ArrowUpRight className="w-3 h-3 mr-0.5" /> 14
                  </div>
                </div>
              </div>
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Lineage Collected
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold text-slate-900">$24,850</div>
                  <div className="text-[10px] text-slate-400 font-medium">85%</div>
                </div>
              </div>
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Prize Fund
                </div>
                <div className="flex items-end justify-between">
                  <div className="text-2xl font-bold text-slate-900">$18,320</div>
                  <DollarSign className="w-3.5 h-3.5 text-slate-400 mb-1" />
                </div>
              </div>
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Collection Rate
                  </div>
                  <div className="text-2xl font-bold text-slate-900">94%</div>
                </div>
                <div className="relative w-9 h-9">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path
                      className="text-slate-100"
                      strokeWidth="4"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-indigo-500"
                      strokeDasharray="94, 100"
                      strokeWidth="4"
                      stroke="currentColor"
                      fill="none"
                      strokeLinecap="round"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                </div>
              </div>
              <div className="bg-white p-3.5 border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition-shadow flex flex-col justify-center">
                <div className="flex justify-between items-end mb-2">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Season
                  </div>
                  <div className="text-xs font-bold text-slate-700">Wk 18/32</div>
                </div>
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-800 rounded-full"
                    style={{ width: `${(18 / 32) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Past Due Bowlers</h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {pastDue.length} bowlers with{" "}
                    <span className="font-semibold text-red-600">
                      ${totalPastDue.toFixed(2)}
                    </span>{" "}
                    outstanding
                  </p>
                </div>
                <button className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-md">
                  View All
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Bowler
                      </th>
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        League
                      </th>
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Amount Due
                      </th>
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Weeks Overdue
                      </th>
                      <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pastDue.map((bowler, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-3.5 whitespace-nowrap relative">
                          <div
                            className={`absolute left-0 top-0 bottom-0 w-1 ${
                              bowler.weeks >= 3 ? "bg-red-500" : "bg-amber-400"
                            }`}
                          />
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                              {bowler.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <span className="font-medium text-slate-900">{bowler.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-3.5 whitespace-nowrap text-sm text-slate-600">
                          {bowler.league}
                        </td>
                        <td className="px-6 py-3.5 whitespace-nowrap">
                          <span className="font-semibold text-red-600">
                            ${bowler.amount.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              bowler.weeks >= 3
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {bowler.weeks} {bowler.weeks === 1 ? "week" : "weeks"}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 whitespace-nowrap text-right">
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

            <div>
              <h2 className="text-lg font-bold text-slate-900 mb-3">League Health</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {leagueHealth.map((league, idx) => (
                  <div
                    key={idx}
                    className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow group cursor-pointer"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="font-semibold text-slate-800 text-sm leading-tight">
                        {league.name}
                      </div>
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${
                          league.status === "green"
                            ? "bg-emerald-500"
                            : league.status === "amber"
                            ? "bg-amber-400"
                            : "bg-red-500"
                        }`}
                      />
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-sm text-slate-600">
                        <span className="font-semibold text-slate-800">{league.bowlers}</span>{" "}
                        bowlers
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-slate-500">Collection</div>
                      <div className="text-sm font-bold text-slate-900">{league.collection}%</div>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-1.5">
                      <div
                        className={`h-full rounded-full transition-all ${
                          league.status === "green"
                            ? "bg-emerald-500"
                            : league.status === "amber"
                            ? "bg-amber-400"
                            : "bg-red-500"
                        }`}
                        style={{ width: `${league.collection}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
