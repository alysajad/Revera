export type LeadStatus = "Fresh" | "Callback" | "Qualified" | "Walk-in" | "Won" | "Lost";
export type Source = "Meta Ads" | "Website" | "CarWale" | "Walk-in";

export type Lead = {
  id: string;
  name: string;
  phone: string;
  source: Source;
  model: string;
  city: string;
  enquiredAt: string;
  status: LeadStatus;
  nextFollowUp?: string;
};

export type Officer = {
  id: string;
  name: string;
  initials: string;
  color: "blue" | "green" | "violet" | "orange";
  assigned: number;
  calls: number;
  qualified: number;
  won: number;
};

export const leads: Lead[] = [
  { id: "RV-24071", name: "Aarav Bhat", phone: "73051 98421", source: "Meta Ads", model: "R8 Pro", city: "Srinagar", enquiredAt: "Today, 09:42", status: "Fresh" },
  { id: "RV-24072", name: "Mehak Kaul", phone: "97972 10468", source: "Website", model: "R7 City", city: "Srinagar", enquiredAt: "Today, 09:17", status: "Fresh" },
  { id: "RV-24073", name: "Danish Mir", phone: "70066 82391", source: "CarWale", model: "R8 Pro", city: "Anantnag", enquiredAt: "Today, 08:54", status: "Fresh" },
  { id: "RV-24074", name: "Zoya Ahmad", phone: "60051 44980", source: "Meta Ads", model: "R7 City", city: "Srinagar", enquiredAt: "Yesterday", status: "Callback", nextFollowUp: "11:30 AM" },
  { id: "RV-24075", name: "Kabir Wani", phone: "94191 23411", source: "Walk-in", model: "R8 Pro", city: "Srinagar", enquiredAt: "Yesterday", status: "Qualified" },
  { id: "RV-24076", name: "Ruhan Shah", phone: "80822 69341", source: "Website", model: "R7 City", city: "Baramulla", enquiredAt: "Yesterday", status: "Fresh" },
  { id: "RV-24077", name: "Iram Khan", phone: "78897 04192", source: "Meta Ads", model: "R8 Lite", city: "Srinagar", enquiredAt: "23 Jul", status: "Fresh" },
  { id: "RV-24078", name: "Faisal Lone", phone: "60065 70420", source: "CarWale", model: "R8 Pro", city: "Srinagar", enquiredAt: "23 Jul", status: "Fresh" },
];

export const officers: Officer[] = [
  { id: "arjun", name: "Arjun Raina", initials: "AR", color: "blue", assigned: 31, calls: 24, qualified: 10, won: 4 },
  { id: "sana", name: "Sana Bhat", initials: "SB", color: "green", assigned: 28, calls: 21, qualified: 8, won: 3 },
  { id: "yusuf", name: "Yusuf Dar", initials: "YD", color: "violet", assigned: 30, calls: 18, qualified: 7, won: 2 },
  { id: "aisha", name: "Aisha Khan", initials: "AK", color: "orange", assigned: 25, calls: 13, qualified: 5, won: 2 },
];

export const sourceClass = (source: Source) => source.toLowerCase().replaceAll(" ", "-");
