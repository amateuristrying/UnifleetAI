import OpenAI from 'openai';
import type {
  AutoResearchPlan,
  AutoResearchResult,
  GitHubRepoContext,
} from '@/types/autoresearch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API_BASE = 'https://api.github.com';
const RESULTS_TSV_TEMPLATE = 'commit\tval_bpb\tmemory_gb\tstatus\tdescription';

const GITHUB_REPO_REGEX =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/|$)/i;

interface GitHubRepoResponse {
  full_name: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
}

interface GitHubContentResponse {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  download_url: string | null;
  content?: string;
  encoding?: string;
}

export class AutoResearchService {
  private static readonly openai = OPENAI_API_KEY
    ? new OpenAI({ apiKey: OPENAI_API_KEY })
    : null;

  static extractRepoRef(repositoryUrl: string): { owner: string; repo: string } {
    const match = repositoryUrl.trim().match(GITHUB_REPO_REGEX);
    if (!match) {
      throw new Error('Repository URL must be a valid GitHub repository URL');
    }

    const owner = match[1];
    const repo = match[2].replace(/\.git$/i, '');

    return { owner, repo };
  }

  static async generateInitialModel(input: {
    repositoryUrl: string;
    objective?: string;
  }): Promise<AutoResearchResult> {
    if (!this.openai) {
      throw new Error('OPENAI_API_KEY is missing');
    }

    const repoRef = this.extractRepoRef(input.repositoryUrl);
    const objective =
      input.objective?.trim() ||
      'Integrate an initial autoresearch workflow in the Unifleet platform';

    const repoContext = await this.buildRepoContext(repoRef.owner, repoRef.repo);
    const plan = await this.buildPlan(repoContext, objective);

    return {
      explanation: this.renderExplanation(repoContext, plan),
      repo: repoContext,
      plan,
    };
  }

  private static async buildRepoContext(
    owner: string,
    repo: string
  ): Promise<GitHubRepoContext> {
    const repoInfo = await this.fetchGitHubJson<GitHubRepoResponse>(
      `/repos/${owner}/${repo}`
    );

    const rootContents = await this.fetchGitHubJson<GitHubContentResponse[]>(
      `/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(
        repoInfo.default_branch
      )}`
    );

    const readmeText = await this.fetchOptionalFile(owner, repo, 'README.md');
    const programText = await this.fetchOptionalFile(owner, repo, 'program.md');

    return {
      owner,
      repo,
      fullName: repoInfo.full_name,
      description: repoInfo.description,
      defaultBranch: repoInfo.default_branch,
      stars: repoInfo.stargazers_count,
      topLevelFiles: rootContents
        .filter((item) => item.type === 'file')
        .slice(0, 10)
        .map((item) => item.name),
      readmeExcerpt: this.truncateText(readmeText ?? '', 3500),
      programExcerpt: programText ? this.truncateText(programText, 3500) : null,
    };
  }

  private static async buildPlan(
    repoContext: GitHubRepoContext,
    objective: string
  ): Promise<AutoResearchPlan> {
    const today = new Date();
    const todayISO = today.toISOString().slice(0, 10);
    const suggestedTag = this.defaultRunTag(today);

    const systemPrompt = `
You design initial "autoresearch" integrations for production apps.
Return JSON only with these fields:
- runTag: string (short lowercase tag)
- objective: string
- summary: string
- setupChecklist: string[]
- initialExperiment: { hypothesis: string, command: string, successMetric: string }
- loopRules: string[]
- resultLogTemplate: string
- risks: string[]

Follow the Karpathy autoresearch baseline:
- baseline-first run
- fixed budget experiment loop
- keep/discard decision rule
- explicit lightweight logging
- simple over complex
- runTag must be based on today's date and look like ${suggestedTag}
- resultLogTemplate must be exactly: ${RESULTS_TSV_TEMPLATE}
`;

    const userPrompt = `
Objective:
${objective}

Date context:
- today: ${todayISO}
- required run tag style example: ${suggestedTag}

Repository context:
- full name: ${repoContext.fullName}
- description: ${repoContext.description ?? 'n/a'}
- default branch: ${repoContext.defaultBranch}
- top files: ${repoContext.topLevelFiles.join(', ') || 'n/a'}

README excerpt:
${repoContext.readmeExcerpt || 'n/a'}

program.md excerpt:
${repoContext.programExcerpt || 'n/a'}

Build an initial autoresearch model that can be integrated as a first iteration in this application.
`;

    const completion = await this.openai!.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt.trim() },
        { role: 'user', content: userPrompt.trim() },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI while building autoresearch plan');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error('Failed to parse autoresearch plan response');
    }

    const fallbackTag = this.defaultRunTag();
    const parsedTemplate = this.getString(
      parsed.resultLogTemplate,
      RESULTS_TSV_TEMPLATE
    );

    return {
      runTag: this.sanitizeRunTag(this.getString(parsed.runTag, fallbackTag), fallbackTag),
      objective: this.getString(parsed.objective, objective),
      summary: this.getString(
        parsed.summary,
        'Initial autoresearch flow with baseline-first and keep/discard loop.'
      ),
      setupChecklist: this.getStringArray(parsed.setupChecklist, [
        'Create an autoresearch branch',
        'Run one baseline experiment without edits',
        'Log result in a tab-separated results file',
      ]),
      initialExperiment: {
        hypothesis: this.getString(
          this.getObject(parsed.initialExperiment).hypothesis,
          'Baseline run verifies reproducible starting point.'
        ),
        command: this.getString(
          this.getObject(parsed.initialExperiment).command,
          'npm run dev'
        ),
        successMetric: this.getString(
          this.getObject(parsed.initialExperiment).successMetric,
          'Lower primary validation metric than baseline'
        ),
      },
      loopRules: this.getStringArray(parsed.loopRules, [
        'Apply one change per experiment.',
        'Keep only when metric improves.',
        'Revert when metric does not improve.',
      ]),
      resultLogTemplate: this.isValidResultsTemplate(parsedTemplate)
        ? parsedTemplate
        : RESULTS_TSV_TEMPLATE,
      risks: this.getStringArray(parsed.risks, [
        'Overfitting to short-term metrics.',
        'Large changes reduce reproducibility.',
      ]),
    };
  }

  private static renderExplanation(
    repoContext: GitHubRepoContext,
    plan: AutoResearchPlan
  ): string {
    const setupLines =
      plan.setupChecklist.length > 0
        ? plan.setupChecklist.map((item) => `- ${item}`).join('\n')
        : '- No setup checklist returned';

    const loopLines =
      plan.loopRules.length > 0
        ? plan.loopRules.map((item) => `- ${item}`).join('\n')
        : '- No loop rules returned';

    const riskLines =
      plan.risks.length > 0
        ? plan.risks.map((item) => `- ${item}`).join('\n')
        : '- No major risks identified';

    return [
      `AutoResearch initial model prepared for ${repoContext.fullName}.`,
      '',
      `Run tag: \`${plan.runTag}\``,
      `Objective: ${plan.objective}`,
      `Summary: ${plan.summary}`,
      '',
      'Setup checklist:',
      setupLines,
      '',
      'Initial experiment:',
      `- Hypothesis: ${plan.initialExperiment.hypothesis}`,
      `- Command: \`${plan.initialExperiment.command}\``,
      `- Success metric: ${plan.initialExperiment.successMetric}`,
      '',
      'Experiment loop rules:',
      loopLines,
      '',
      'results.tsv template:',
      `\`${plan.resultLogTemplate}\``,
      '',
      'Risks:',
      riskLines,
    ].join('\n');
  }

  private static async fetchOptionalFile(
    owner: string,
    repo: string,
    path: string
  ): Promise<string | null> {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(
        path
      )}`,
      {
        headers: this.githubHeaders(),
        cache: 'no-store',
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`GitHub file fetch failed (${path}): ${response.status}`);
    }

    const payload = (await response.json()) as GitHubContentResponse;

    if (payload.content && payload.encoding === 'base64') {
      return Buffer.from(payload.content, 'base64').toString('utf8');
    }

    if (payload.download_url) {
      const raw = await fetch(payload.download_url, {
        headers: this.githubHeaders(),
        cache: 'no-store',
      });

      if (!raw.ok) {
        throw new Error(
          `GitHub raw file fetch failed (${path}): ${raw.status}`
        );
      }

      return await raw.text();
    }

    return null;
  }

  private static async fetchGitHubJson<T>(path: string): Promise<T> {
    const response = await fetch(`${GITHUB_API_BASE}${path}`, {
      headers: this.githubHeaders(),
      cache: 'no-store',
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`GitHub request failed (${response.status}): ${message}`);
    }

    return (await response.json()) as T;
  }

  private static githubHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'unifleet-autoresearch',
    };

    if (GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
    }

    return headers;
  }

  private static truncateText(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
      return value;
    }
    return `${value.slice(0, maxChars)}\n...`;
  }

  private static getObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private static getString(value: unknown, fallback: string): string {
    if (typeof value !== 'string') {
      return fallback;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  private static getStringArray(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) {
      return fallback;
    }

    const normalized = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 10);

    return normalized.length > 0 ? normalized : fallback;
  }

  private static sanitizeRunTag(candidate: string, fallback: string): string {
    const normalized = candidate.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!normalized || normalized.length < 3 || normalized.length > 20) {
      return fallback;
    }
    return normalized;
  }

  private static isValidResultsTemplate(template: string): boolean {
    return (
      template.trim() === RESULTS_TSV_TEMPLATE ||
      template.trim() === 'commit\tval_bpb\tmemory_gb\tstatus\tdescription'
    );
  }

  private static defaultRunTag(now: Date = new Date()): string {
    const month = now.toLocaleString('en-US', { month: 'short' }).toLowerCase();
    const day = `${now.getDate()}`;
    return `${month}${day}`;
  }
}
