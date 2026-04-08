export interface GitHubRepoContext {
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  topLevelFiles: string[];
  readmeExcerpt: string;
  programExcerpt: string | null;
}

export interface AutoResearchPlan {
  runTag: string;
  objective: string;
  summary: string;
  setupChecklist: string[];
  initialExperiment: {
    hypothesis: string;
    command: string;
    successMetric: string;
  };
  loopRules: string[];
  resultLogTemplate: string;
  risks: string[];
}

export interface AutoResearchResult {
  explanation: string;
  repo: GitHubRepoContext;
  plan: AutoResearchPlan;
}
