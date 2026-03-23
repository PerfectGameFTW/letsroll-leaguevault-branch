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

export const CleanTabBar: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [isAdmin] = useState(true); // Mocking system admin status for the back link

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-6 pb-24">
            {/* System Admin Back Link */}
            {isAdmin && (
              <button className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors mb-2">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Admin Dashboard
              </button>
            )}

            {/* Greeting Section */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h2 className="text-2xl font-bold text-slate-900 mb-1">Hi, Mike Johnson</h2>
              <p className="text-slate-500">Tuesday Night Scratch League</p>
              
              <div className="mt-4 flex flex-wrap gap-3">
                <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 text-sm font-medium">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 mr-2"></span>
                  Pin Crushers
                </div>
                <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-sm font-medium">
                  <Calendar className="w-4 h-4 mr-1.5" />
                  Week 14 of 30
                </div>
              </div>
            </div>

            {/* Payment Status Cards */}
            <div>
              <h3 className="text-lg font-semibold text-slate-800 mb-3 px-1">Financial Overview</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-500 font-medium">Total Paid</span>
                    <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-slate-900">$420.00</div>
                    <div className="text-sm text-emerald-600 font-medium mt-1">Up to date</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-slate-500 font-medium">Remaining</span>
                    <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
                      <CreditCard className="w-4 h-4 text-amber-600" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-slate-900">$210.00</div>
                    <div className="text-sm text-slate-500 mt-1">Due by end of season</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-slate-500 font-medium">Progress</span>
                  </div>
                  <div>
                    <div className="flex items-end justify-between mb-2">
                      <div className="text-3xl font-bold text-slate-900">66%</div>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 mb-1">
                      <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: '66%' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Payments Table */}
            <div>
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-lg font-semibold text-slate-800">Recent Payments</h3>
                <button className="text-sm font-medium text-indigo-600 hover:text-indigo-700">View All</button>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {[
                    { date: 'Oct 24, 2023', amount: '$30.00', status: 'Completed', method: 'Credit Card' },
                    { date: 'Oct 17, 2023', amount: '$30.00', status: 'Completed', method: 'Cash' },
                    { date: 'Oct 10, 2023', amount: '$60.00', status: 'Completed', method: 'Credit Card' },
                  ].map((payment, i) => (
                    <div key={i} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <CreditCard className="w-5 h-5 text-slate-500" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{payment.amount}</div>
                          <div className="text-sm text-slate-500">{payment.date} &bull; {payment.method}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium">
                          {payment.status}
                        </span>
                        <ChevronRight className="w-5 h-5 text-slate-400" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      case 'history':
        return (
          <div className="flex items-center justify-center h-64 pb-24">
            <div className="text-center text-slate-500">
              <History className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Payment History Page Content</p>
            </div>
          </div>
        );
      case 'profile':
        return (
          <div className="flex flex-col items-center justify-center h-64 pb-24">
            <div className="text-center text-slate-500 mb-6">
              <UserCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Profile Settings Page Content</p>
            </div>
            <button className="flex items-center px-4 py-2 bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100 transition-colors">
              <LogOut className="w-4 h-4 mr-2" />
              Log Out
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen max-h-screen bg-[#f8fafc] overflow-hidden relative font-sans">
      {/* Top Header */}
      <header className="flex-none bg-white border-b border-slate-200 px-4 h-16 flex items-center justify-between z-10 shadow-sm">
        {/* Org Logo */}
        <div className="flex items-center">
          <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center shadow-inner">
            <span className="text-white font-bold text-sm tracking-wider">PG</span>
          </div>
        </div>

        {/* Center Name (visible on slightly larger screens or standard) */}
        <div className="hidden sm:block absolute left-1/2 transform -translate-x-1/2">
          <h1 className="text-base font-semibold text-slate-900">Mike Johnson</h1>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          <button className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
          </button>
          <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm border border-indigo-200 cursor-pointer">
            MJ
          </div>
        </div>
      </header>

      {/* Main Scrollable Content */}
      <main className="flex-1 overflow-y-auto w-full">
        <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6">
          {renderContent()}
        </div>
      </main>

      {/* Fixed Bottom Tab Bar */}
      <div className="flex-none bg-white border-t border-slate-200 pb-safe z-20 shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">
        <div className="max-w-md mx-auto flex justify-between px-2 h-16">
          <button 
            onClick={() => setActiveTab('overview')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 min-w-[70px] ${activeTab === 'overview' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <div className={`flex items-center justify-center w-10 h-8 rounded-full transition-all duration-200 ${activeTab === 'overview' ? 'bg-indigo-50' : 'bg-transparent'}`}>
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-semibold tracking-wide">Overview</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 min-w-[70px] ${activeTab === 'history' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <div className={`flex items-center justify-center w-10 h-8 rounded-full transition-all duration-200 ${activeTab === 'history' ? 'bg-indigo-50' : 'bg-transparent'}`}>
              <History className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-semibold tracking-wide">History</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('profile')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 min-w-[70px] ${activeTab === 'profile' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <div className={`flex items-center justify-center w-10 h-8 rounded-full transition-all duration-200 ${activeTab === 'profile' ? 'bg-indigo-50' : 'bg-transparent'}`}>
              <UserCircle className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-semibold tracking-wide">Profile</span>
          </button>
        </div>
      </div>
    </div>
  );
};
