export interface Article {
  title: string;
  summary: string;
  link: string;
  source: string;
  pubDate: Date;
  category: string;
  urlHash: string;
  /** Regional tier inherited from the source (1 = Luzerne, 2 = adjacent, 3 = outer). */
  tier: number;
  /** County the source covers; undefined for national/statewide sources. */
  county?: string;
  /** Set only for items from a calendar feed, where the date is a start time. */
  eventDate?: Date;
}

export interface Source {
  id: number;
  name: string;
  url: string;
  /** 'rss' for feeds, 'ical' for published event calendars. */
  type: string;
  category: string;
  active: number;
  tier: number;
  county?: string;
}

export interface FamilyMember {
  id: number;
  name: string;
  email: string;
  additional_emails: string[];
  interests: string[];
}
