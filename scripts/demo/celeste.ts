// Shared Celeste demo catalog: the jobs members hire the app for, and the screens of its built-in Marver canvas
// (demo/celeste-design), standing in for a real design repo until one is connected.

export const JOBS = [
  { code: "T01", section: "Daily guidance", title: "Read today's horoscope and the moon phase", current_flow_md: "- Open the app\n- Read Today" },
  { code: "T02", section: "Daily guidance", title: "Get my daily reading at the right time", current_flow_md: "- Open Notifications\n- Turn on Daily horoscope\n- Choose a time" },
  { code: "T03", section: "Daily guidance", title: "Keep a journal alongside the moon" },
  { code: "C01", section: "My chart", title: "Set up my birth chart", current_flow_md: "- Enter date of birth\n- Enter birth time and choose AM or PM\n- Enter birth place\n- Continue to the chart" },
  { code: "C02", section: "My chart", title: "Understand what my chart says" },
  { code: "C03", section: "My chart", title: "Correct my birth details", current_flow_md: "- Open Chart\n- Tap Edit birth details\n- Change the date, time or place\n- Continue" },
  { code: "F01", section: "Friends", title: "Compare charts with a friend", current_flow_md: "- Open Friends\n- Tap a friend\n- Choose which chart to compare\n- Read the match" },
  { code: "F02", section: "Friends", title: "Share my chart" },
  { code: "P01", section: "Celeste Plus", title: "Start or restore Celeste Plus", current_flow_md: "- Tap the Plus banner on Today\n- Read what Plus adds\n- Start free trial, or Restore purchase" },
  { code: "X01", section: "Outside the member jobs", title: "App speed and reliability" },
];

export const SCREENS = [
  { frame_id: "today/index", scene: "today", title: "Today", description: "Daily horoscope for your sun sign, the moon phase, today's transits, Journal and Compare shortcuts" },
  { frame_id: "onboarding/birth-details", scene: "onboarding", title: "Birth details", description: "Date of birth, birth time with AM or PM, birth place, Continue; a small I don't know my birth time link" },
  { frame_id: "chart/natal", scene: "chart", title: "Birth chart", description: "Chart wheel, the big three (Sun, Moon, Rising), placements, Share chart, Edit birth details" },
  { frame_id: "friends/list", scene: "friends", title: "Friends", description: "Friends with their sun signs; tap a friend to open a compatibility reading; Add a friend" },
  { frame_id: "compatibility/match", scene: "compatibility", title: "Compatibility", description: "You and a friend: which chart to use, the match in words, how you connect, strengths and what to watch for" },
  { frame_id: "journal/entry", scene: "journal", title: "Journal entry", description: "Today's moon phase, a mood, a note, Save entry; past entries listed by date" },
  { frame_id: "settings/notifications", scene: "settings", title: "Notifications", description: "Daily horoscope push and the time it is sent, moon phase alerts, friend activity" },
  { frame_id: "plus/upgrade", scene: "plus", title: "Celeste Plus", description: "What Plus adds, the free trial, Start free trial, Restore purchase" },
];
