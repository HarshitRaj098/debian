import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  Trash2, 
  CheckCircle2, 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  X, 
  Clock, 
  Plus, 
  Check, 
  ExternalLink,
  CalendarDays
} from 'lucide-react';
import { NotificationItem, CalendarReminder } from '../types/desktop';

interface CalendarNotificationsShadeProps {
  notifications: NotificationItem[];
  onClearNotifications: () => void;
  onDismissNotification: (id: string) => void;
  onOpenNotificationApp: (notification: NotificationItem) => void;
  onClose: () => void;
  initialTab?: 'calendar' | 'notifications';
  reminders: CalendarReminder[];
  onAddReminder: (reminder: CalendarReminder) => void;
  onDeleteReminder: (id: string) => void;
  onToggleReminder: (id: string) => void;
}

export const CalendarNotificationsShade: React.FC<CalendarNotificationsShadeProps> = ({
  notifications,
  onClearNotifications,
  onDismissNotification,
  onOpenNotificationApp,
  onClose,
  initialTab = 'calendar',
  reminders,
  onAddReminder,
  onDeleteReminder,
  onToggleReminder
}) => {
  const [activeTab, setActiveTab] = useState<'calendar' | 'notifications'>(initialTab);
  const [monthOffset, setMonthOffset] = useState<number>(0);
  const [selectedDay, setSelectedDay] = useState<number>(new Date().getDate());
  const [newReminderText, setNewReminderText] = useState<string>('');
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Dynamic Clock updating every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const baseDate = new Date();
  const displayDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + monthOffset, 1);
  const displayYear = displayDate.getFullYear();
  const displayMonth = displayDate.getMonth();

  const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
  const firstDayIndex = new Date(displayYear, displayMonth, 1).getDay();

  const isCurrentMonth = monthOffset === 0;
  const todayDate = baseDate.getDate();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const currentDateKey = `${displayYear}-${String(displayMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
  const dayReminders = reminders.filter(r => r.dateKey === currentDateKey);

  const handleAddReminderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReminderText.trim()) return;
    const newRem: CalendarReminder = {
      id: `rem_${Date.now()}`,
      dateKey: currentDateKey,
      title: newReminderText.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      completed: false
    };
    onAddReminder(newRem);
    setNewReminderText('');
  };

  const formattedLiveTime = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const formattedLiveDate = currentTime.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div 
      className="calendar-notifications-shade fixed top-8 left-1/2 -translate-x-1/2 w-[680px] max-w-[95vw] bg-[#1e1e1e]/98 backdrop-blur-3xl border border-white/15 rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.85)] z-50 text-white select-none overflow-hidden animate-in fade-in zoom-in-95 duration-100 flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Header Bar with Tabs and Close Button */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#141414] border-b border-white/10">
        <div className="flex items-center gap-1.5 p-0.5 bg-white/5 rounded-lg border border-white/5">
          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex items-center gap-2 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'calendar' 
                ? 'bg-[#E95420] text-white shadow-sm' 
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <CalendarIcon size={14} />
            <span>Calendar & Clock</span>
          </button>
          <button
            onClick={() => setActiveTab('notifications')}
            className={`flex items-center gap-2 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
              activeTab === 'notifications' 
                ? 'bg-[#E95420] text-white shadow-sm' 
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <Bell size={14} />
            <span>Notifications</span>
            {notifications.length > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                activeTab === 'notifications' ? 'bg-white text-[#E95420]' : 'bg-[#E95420] text-white'
              }`}>
                {notifications.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono text-white/50 bg-white/5 px-2.5 py-1 rounded-md">
            <Clock size={12} className="text-[#E95420]" />
            <span>{formattedLiveTime}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/60 hover:text-white transition-colors"
            title="Close shade (or click outside)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Main Body */}
      {activeTab === 'calendar' ? (
        <div className="p-5 flex flex-col md:flex-row gap-6 min-h-[380px]">
          {/* Left Column: Live System Clock & Reminders */}
          <div className="w-full md:w-64 flex flex-col justify-between border-b md:border-b-0 md:border-r border-white/10 pb-4 md:pb-0 md:pr-6">
            <div>
              {/* Big Digital Clock */}
              <div className="bg-black/30 border border-white/5 rounded-2xl p-4 mb-4">
                <div className="text-3xl font-light font-mono tracking-tight text-white mb-0.5">
                  {formattedLiveTime}
                </div>
                <div className="text-xs font-medium text-[#E95420]">
                  {formattedLiveDate}
                </div>
                <div className="text-[10px] text-white/40 mt-1 font-mono">
                  Canonical GNOME System Time
                </div>
              </div>

              {/* Day Schedule / Reminders */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white/90">
                    Schedule for {monthNames[displayMonth].slice(0, 3)} {selectedDay}
                  </span>
                  <span className="text-[10px] font-mono text-white/40">
                    {dayReminders.length} event{dayReminders.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="max-h-44 overflow-y-auto space-y-1.5 mb-3 pr-1">
                  {dayReminders.length === 0 ? (
                    <div className="text-[11px] text-white/40 py-3 text-center bg-white/5 rounded-xl border border-dashed border-white/10">
                      No events for this date.
                    </div>
                  ) : (
                    dayReminders.map(rem => (
                      <div 
                        key={rem.id}
                        className={`flex items-center justify-between p-2 rounded-xl text-xs border transition-all ${
                          rem.completed 
                            ? 'bg-white/5 border-white/5 text-white/40 line-through' 
                            : 'bg-white/10 border-white/10 text-white'
                        }`}
                      >
                        <button
                          onClick={() => onToggleReminder(rem.id)}
                          className={`w-4 h-4 rounded flex items-center justify-center mr-2 shrink-0 border transition-colors ${
                            rem.completed 
                              ? 'bg-emerald-600 border-emerald-500 text-white' 
                              : 'border-white/30 hover:border-[#E95420]'
                          }`}
                        >
                          {rem.completed && <Check size={10} strokeWidth={3} />}
                        </button>
                        <span className="flex-1 truncate text-[11px]">{rem.title}</span>
                        <button
                          onClick={() => onDeleteReminder(rem.id)}
                          className="text-white/40 hover:text-red-400 ml-1.5 p-1 rounded hover:bg-white/10 transition-colors"
                          title="Delete reminder"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add Reminder Form */}
                <form onSubmit={handleAddReminderSubmit} className="flex gap-1.5">
                  <input
                    type="text"
                    value={newReminderText}
                    onChange={(e) => setNewReminderText(e.target.value)}
                    placeholder={`+ Add task for ${monthNames[displayMonth].slice(0, 3)} ${selectedDay}...`}
                    className="flex-1 bg-white/10 border border-white/10 focus:border-[#E95420] text-white placeholder-white/40 text-[11px] px-2.5 py-1.5 rounded-lg outline-none"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 bg-[#E95420] hover:bg-[#d84818] text-white text-[11px] font-semibold rounded-lg transition-colors flex items-center justify-center shrink-0"
                  >
                    <Plus size={13} />
                  </button>
                </form>
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 text-[10px] text-white/40 flex items-center justify-between">
              <span>Selected: {monthNames[displayMonth]} {selectedDay}, {displayYear}</span>
              <span className="text-emerald-400 font-mono">Synced</span>
            </div>
          </div>

          {/* Right Column: Interactive Month Calendar */}
          <div className="flex-1 flex flex-col">
            {/* Month & Year Navigation Header */}
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <CalendarDays size={18} className="text-[#E95420]" />
                <span className="text-sm font-bold text-white">{monthNames[displayMonth]} {displayYear}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button 
                  onClick={() => setMonthOffset(prev => prev - 1)}
                  className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                  title="Previous Month"
                >
                  <ChevronLeft size={16} />
                </button>
                {monthOffset !== 0 && (
                  <button 
                    onClick={() => {
                      setMonthOffset(0);
                      setSelectedDay(todayDate);
                    }}
                    className="text-xs px-2 py-1 rounded-lg hover:bg-white/10 text-[#E95420] font-semibold transition-colors"
                    title="Return to Current Month"
                  >
                    Today
                  </button>
                )}
                <button 
                  onClick={() => setMonthOffset(prev => prev + 1)}
                  className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors"
                  title="Next Month"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            {/* Days of Week Header */}
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-white/40 mb-2">
              <span>Su</span>
              <span>Mo</span>
              <span>Tu</span>
              <span>We</span>
              <span>Th</span>
              <span>Fr</span>
              <span>Sa</span>
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1.5 text-center text-xs flex-1">
              {Array.from({ length: firstDayIndex }).map((_, i) => (
                <div key={`empty-${i}`} className="h-9" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const isToday = isCurrentMonth && dayNum === todayDate;
                const isSelected = dayNum === selectedDay;
                const hasReminder = reminders.some(r => r.dateKey === `${displayYear}-${String(displayMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`);

                return (
                  <button
                    key={dayNum}
                    onClick={() => setSelectedDay(dayNum)}
                    className={`h-9 flex flex-col items-center justify-center rounded-xl font-medium transition-all relative ${
                      isToday 
                        ? 'bg-[#E95420] text-white font-bold shadow-md ring-2 ring-[#E95420]/50' 
                        : isSelected 
                          ? 'bg-white/20 text-white font-bold ring-1 ring-white/30' 
                          : 'hover:bg-white/10 text-white/80'
                    }`}
                  >
                    <span>{dayNum}</span>
                    {hasReminder && (
                      <span className={`w-1 h-1 rounded-full ${isToday ? 'bg-white' : 'bg-[#E95420]'}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Notifications View */
        <div className="p-5 flex flex-col min-h-[380px]">
          {/* Notifications Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
            <div className="flex items-center gap-2">
              <Bell size={18} className="text-[#E95420]" />
              <span className="text-sm font-bold">Notification History</span>
              {notifications.length > 0 && (
                <span className="bg-[#E95420] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {notifications.length}
                </span>
              )}
            </div>
            {notifications.length > 0 && (
              <button
                onClick={onClearNotifications}
                className="text-xs text-white/60 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <Trash2 size={13} />
                <span>Clear All</span>
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-[360px]">
            {notifications.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-white/40">
                <CheckCircle2 size={44} className="mb-3 text-emerald-500/70" />
                <span className="text-sm font-semibold text-white/80">No Notifications</span>
                <span className="text-xs text-white/40 mt-1">You are all caught up! System is running smoothly.</span>
              </div>
            ) : (
              notifications.map(item => (
                <div 
                  key={item.id}
                  onClick={() => onOpenNotificationApp(item)}
                  className="bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-xl p-3.5 transition-all cursor-pointer group relative"
                  title={`Click to open ${item.app}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-[#E95420] uppercase tracking-wider bg-[#E95420]/15 px-2 py-0.5 rounded">
                        {item.app}
                      </span>
                      <span className="text-[11px] text-white/40 font-mono">{item.time}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="opacity-0 group-hover:opacity-100 text-[10px] text-[#E95420] font-medium flex items-center gap-1 mr-2 transition-opacity">
                        <span>Open App</span>
                        <ExternalLink size={10} />
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDismissNotification(item.id);
                        }}
                        className="text-white/40 hover:text-white p-1 rounded hover:bg-white/15 transition-colors"
                        title="Dismiss notification"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-white/95 leading-tight mb-1">{item.title}</div>
                  <div className="text-[11px] text-white/60 leading-relaxed">{item.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
