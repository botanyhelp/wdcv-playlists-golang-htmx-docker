export interface Track {
  id: string;
  timestamp: string; // ISO or formatted string
  artist: string;
  title: string;
  showName: string;
  isFeatured: boolean;
}

export interface FilterState {
  show: string;
  regex: string;
  fromDate: string;
  toDate: string;
  featuredOnly: boolean;
}

export interface CodeFile {
  filename: string;
  path: string;
  language: string;
  description: string;
  content: string;
}
