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

export const FloatingDock = () => {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans relative pb-32">
      {/* Ultra-minimal Header */}
      <header className="px-6 py-6 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-lg tracking-tight">PG</span>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-semibold text-slate-900">Perfect Game</h1>
            <p className="text-xs text-slate-500">League Manager</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button className="text-slate-400 hover:text-slate-600 transition-colors relative">
            <Bell size={20} />
            <span className="absolute top-0 right-0 w-2 h-2 bg-rose-500 rounded-full"></span>
          </button>
          <div className="h-9 w-9 bg-slate-200 rounded-full flex items-center justify-center overflow-hidden border-2 border-white shadow-sm cursor-pointer">
            <span className="text-sm font-medium text-slate-600">MJ</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="px-6 max-w-5xl mx-auto">
        {activeTab === 'overview' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Greeting Section */}
            <section className="pt-4">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-2">
                Welcome back, Mike
              </h2>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-slate-600">
                <span className="font-medium text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full text-sm">
                  Tuesday Night Scratch League
                </span>
                <span className="flex items-center gap-1.5 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                  Team: Pin Crushers
                </span>
                <span className="flex items-center gap-1.5 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                  Week 14 of 30
                </span>
              </div>
            </section>

            {/* Payment Status Cards */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-slate-500">Total Paid</h3>
                  <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                    <CreditCard size={18} />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">$420.00</div>
                  <p className="text-xs text-emerald-600 font-medium mt-1">+ On track for season</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-slate-500">Remaining Balance</h3>
                  <div className="p-2 bg-rose-50 rounded-lg text-rose-600">
                    <TrendingUp size={18} />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">$210.00</div>
                  <p className="text-xs text-slate-500 mt-1">Due by end of season</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-slate-500">Payment Progress</h3>
                  <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                    <Calendar size={18} />
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">66%</div>
                  <div className="w-full bg-slate-100 h-2 rounded-full mt-2 overflow-hidden">
                    <div className="bg-indigo-600 w-[66%] h-full rounded-full"></div>
                  </div>
                </div>
              </div>

              <div className="bg-indigo-600 rounded-2xl p-5 shadow-md text-white flex flex-col justify-between relative overflow-hidden">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full blur-xl"></div>
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-indigo-100">Next Payment</h3>
                  <div className="text-2xl font-bold mt-1">$30.00</div>
                </div>
                <button className="w-full py-2 bg-white text-indigo-600 rounded-xl text-sm font-semibold shadow-sm hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1.5">
                  Pay Now <ChevronRight size={16} />
                </button>
              </div>
            </section>

            {/* Recent Payments Mini-table */}
            <section className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">Recent Payments</h3>
                <button className="text-sm text-indigo-600 font-medium hover:text-indigo-700">View All</button>
              </div>
              <div className="divide-y divide-slate-100">
                {[
                  { date: 'Oct 24, 2023', amount: '$30.00', status: 'Completed', method: 'Credit Card ending in 4242' },
                  { date: 'Oct 17, 2023', amount: '$30.00', status: 'Completed', method: 'Cash (at center)' },
                  { date: 'Oct 10, 2023', amount: '$30.00', status: 'Completed', method: 'Credit Card ending in 4242' },
                ].map((payment, i) => (
                  <div key={i} className="p-4 sm:px-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                        <CreditCard size={18} />
                      </div>
                      <div>
                        <div className="font-medium text-slate-900">{payment.amount}</div>
                        <div className="text-xs text-slate-500">{payment.date}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="inline-flex items-center px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium">
                        {payment.status}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 hidden sm:block">{payment.method}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="pt-4 space-y-6 animate-in fade-in duration-500">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Payment History</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center text-slate-500">
              <History className="mx-auto h-12 w-12 text-slate-300 mb-3" />
              <p>Full payment history would appear here.</p>
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="pt-4 space-y-6 animate-in fade-in duration-500">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Profile Settings</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center text-slate-500">
              <UserCircle className="mx-auto h-12 w-12 text-slate-300 mb-3" />
              <p>Profile configuration would appear here.</p>
            </div>
          </div>
        )}
      </main>

      {/* Floating Dock Navigation */}
      <div className="fixed bottom-6 left-0 right-0 flex justify-center z-50 px-4 pointer-events-none">
        <nav className="bg-white/80 backdrop-blur-md shadow-lg border border-slate-200/50 p-2 rounded-full flex items-center gap-2 pointer-events-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-3 rounded-full transition-all duration-300 ${
              activeTab === 'overview' 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
            }`}
          >
            <LayoutDashboard size={20} />
            {activeTab === 'overview' && <span className="text-sm font-medium pr-1">Overview</span>}
          </button>
          
          <div className="w-px h-8 bg-slate-200/50"></div>
          
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-3 rounded-full transition-all duration-300 ${
              activeTab === 'history' 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
            }`}
          >
            <History size={20} />
            {activeTab === 'history' && <span className="text-sm font-medium pr-1">History</span>}
          </button>
          
          <div className="w-px h-8 bg-slate-200/50"></div>
          
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-2 px-4 py-3 rounded-full transition-all duration-300 ${
              activeTab === 'profile' 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
            }`}
          >
            <UserCircle size={20} />
            {activeTab === 'profile' && <span className="text-sm font-medium pr-1">Profile</span>}
          </button>
        </nav>
      </div>
    </div>
  );
};

export default FloatingDock;
