export interface Article {
  title: string;
  summary: string;
  link: string;
  source: string;
  pubDate: Date;
  category: string;
  urlHash: string;
}

export interface Source {
  id: number;
  name: string;
  url: string;
  type: string;
  category: string;
  active: number;
}

export interface FamilyMember {
  id: number;
  name: string;
  email: string;
  alternate_email?: string;
  interests: string[];
}
