import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  History, 
  UserCircle, 
  CreditCard, 
  TrendingUp, 
  Calendar, 
  ChevronRight, 
  LogOut, 
  Bell, 
  ArrowLeft 
} from 'lucide-react';

export const IntegratedTopBar = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'history', label: 'Payment History', icon: History },
    { id: 'profile', label: 'Profile', icon: UserCircle },
  ];

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans text-slate-900">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 px-4 h-16 flex items-center justify-between shrink-0">
        
        {/* Left: Branding */}
        <div className="flex items-center gap-3 shrink-0 w-1/4">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-xs tracking-wider">PG</span>
          </div>
          <span className="font-semibold text-slate-800 hidden md:block">Perfect Game</span>
        </div>

        {/* Center: Navigation Tabs */}
        <nav className="flex items-center justify-center flex-1 max-w-md mx-auto h-full">
          <div className="flex p-1 bg-slate-100 rounded-full w-full max-w-sm overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive 
                      ? 'bg-white text-indigo-700 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : ''}`} />
                  <span className={`${isActive ? 'block' : 'hidden sm:block'}`}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Right: User Controls */}
        <div className="flex items-center justify-end gap-2 sm:gap-4 shrink-0 w-1/4">
          <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full border-2 border-white"></span>
          </button>
          
          <div className="relative">
            <button 
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="flex items-center gap-2 p-1 pr-2 hover:bg-slate-100 rounded-full transition-colors border border-transparent hover:border-slate-200"
            >
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold text-sm">
                MJ
              </div>
            </button>
            
            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-100 py-1 z-50">
                <div className="px-4 py-2 border-b border-slate-100 mb-1">
                  <p className="text-sm font-medium text-slate-900">Mike Johnson</p>
                  <p className="text-xs text-slate-500 truncate">mike.j@example.com</p>
                </div>
                <button className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                  <UserCircle className="w-4 h-4" />
                  Account Settings
                </button>
                <button className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2">
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
        
        {/* System Admin Back Link (conditional) */}
        <div className="flex items-center">
          <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 transition-colors bg-white/50 px-3 py-1.5 rounded-full border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/50">
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Admin Dashboard</span>
          </button>
        </div>

        {/* Greeting Section */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/60 flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
          
          <div className="relative z-10 space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Welcome back, Mike!
            </h1>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-slate-600">
              <span className="font-medium text-indigo-700">Tuesday Night Scratch League</span>
              <span className="hidden sm:inline text-slate-300">•</span>
              <span className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                Team: Pin Crushers
              </span>
            </div>
          </div>
          
          <div className="relative z-10 flex items-center gap-3 bg-slate-50 p-3 sm:px-5 sm:py-3.5 rounded-xl border border-slate-100 shrink-0">
            <Calendar className="w-5 h-5 text-indigo-600" />
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Current Season</p>
              <p className="text-sm font-semibold text-slate-800">Week 14 of 30</p>
            </div>
          </div>
        </div>

        {/* Payment Status Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Card 1: Paid */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/60 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CreditCard className="w-5 h-5" />
              </div>
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                Up to date
              </span>
            </div>
            <p className="text-sm text-slate-500 font-medium mb-1">Total Paid</p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-bold text-slate-900">$420.00</h3>
            </div>
          </div>

          {/* Card 2: Remaining */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/60 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <p className="text-sm text-slate-500 font-medium mb-1">Remaining Balance</p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-2xl font-bold text-slate-900">$210.00</h3>
            </div>
          </div>

          {/* Card 3: Progress */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200/60 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <LayoutDashboard className="w-5 h-5" />
              </div>
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
                66%
              </span>
            </div>
            <p className="text-sm text-slate-500 font-medium mb-2">Payment Progress</p>
            <div className="w-full bg-slate-100 h-2.5 rounded-full mt-auto mb-1 overflow-hidden">
              <div className="bg-indigo-600 h-full rounded-full w-[66%]"></div>
            </div>
          </div>
        </div>

        {/* Recent Payments Mini-table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Recent Payments</h2>
            <button className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
              View All
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 bg-slate-50/50 uppercase border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium">Method</th>
                  <th className="px-5 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-4 text-slate-600">Nov 12, 2023</td>
                  <td className="px-5 py-4 font-medium text-slate-900">Weeks 13-14 Dues</td>
                  <td className="px-5 py-4 text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-4 bg-slate-200 rounded text-[8px] flex items-center justify-center font-bold text-slate-600">VISA</div>
                      <span>•••• 4242</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 font-semibold text-slate-900 text-right">$30.00</td>
                </tr>
                <tr className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-4 text-slate-600">Oct 29, 2023</td>
                  <td className="px-5 py-4 font-medium text-slate-900">Weeks 9-12 Dues</td>
                  <td className="px-5 py-4 text-slate-600">Cash</td>
                  <td className="px-5 py-4 font-semibold text-slate-900 text-right">$60.00</td>
                </tr>
                <tr className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-5 py-4 text-slate-600">Oct 01, 2023</td>
                  <td className="px-5 py-4 font-medium text-slate-900">Weeks 5-8 Dues</td>
                  <td className="px-5 py-4 text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-4 bg-slate-200 rounded text-[8px] flex items-center justify-center font-bold text-slate-600">VISA</div>
                      <span>•••• 4242</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 font-semibold text-slate-900 text-right">$60.00</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
      </main>
    </div>
  );
};
