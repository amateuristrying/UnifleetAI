import { NextResponse } from 'next/server';
import { AutoResearchService } from '@/services/autoresearch';

const GITHUB_URL_REGEX = /(https?:\/\/github\.com\/[^\s]+)/i;

function extractGithubUrl(value: string): string | null {
  const match = value.match(GITHUB_URL_REGEX);
  if (!match) {
    return null;
  }
  return match[1].trim();
}

function stripRepoFromObjective(query: string, repoUrl: string): string {
  return query
    .replace(/^\/research/i, '')
    .replace(repoUrl, '')
    .replace(/^\s*\|\s*/, '')
    .trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      repositoryUrl?: string;
      objective?: string;
      query?: string;
    };

    const repositoryUrl =
      body.repositoryUrl?.trim() ||
      (body.query ? extractGithubUrl(body.query) : null);

    if (!repositoryUrl) {
      return NextResponse.json(
        {
          error:
            'repositoryUrl is required. You can also send query like: /research <github-url> | <objective>',
        },
        { status: 400 }
      );
    }

    const objectiveFromQuery = body.query
      ? stripRepoFromObjective(body.query, repositoryUrl)
      : '';

    const objective = body.objective?.trim() || objectiveFromQuery || undefined;

    const result = await AutoResearchService.generateInitialModel({
      repositoryUrl,
      objective,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[AutoResearch API] Error:', message);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
