import type { Request, Response } from "express";
import {
  authenticateInfrastructureProvider,
  createInfrastructureOnboardingSession,
  createInfrastructurePartner,
  discoverInfrastructure,
  getInfrastructureOnboardingOverview,
  getInfrastructureOnboardingSession,
  importInfrastructureCandidates,
  infrastructureProviderCatalog,
  listInfrastructurePartners,
  promoteInfrastructureCandidate,
  promoteInfrastructureCandidates,
  verifyInfrastructureCandidate,
  verifyInfrastructureCandidates,
} from "../infrastructure-onboarding/service";
import { sendPublicApiError } from "../services/publicApi";

function actor(req: Request) {
  return req.user as any;
}

function fail(res: Response, error: unknown, operation: string) {
  return sendPublicApiError(
    res,
    error,
    { statusCode: 503, code: "infrastructure_onboarding_unavailable", message: "Infrastructure onboarding is temporarily unavailable." },
    { operation },
  );
}

export async function providerCatalog(req: Request, res: Response) {
  try {
    return res.json({ providers: await infrastructureProviderCatalog(actor(req)) });
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.providers");
  }
}

export async function overview(req: Request, res: Response) {
  try {
    return res.json(await getInfrastructureOnboardingOverview(actor(req)));
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.overview");
  }
}

export async function createSession(req: Request, res: Response) {
  try {
    return res.status(201).json({ session: await createInfrastructureOnboardingSession(actor(req), req.body || {}) });
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.session.create");
  }
}

export async function sessionDetail(req: Request, res: Response) {
  try {
    return res.json(await getInfrastructureOnboardingSession(actor(req), req.params.sessionId));
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.session.detail");
  }
}

export async function authenticateProvider(req: Request, res: Response) {
  try {
    const connection = await authenticateInfrastructureProvider(actor(req), req.params.sessionId, req.params.providerKey, req.body || {});
    return res.json({ connection });
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.provider.authenticate");
  }
}

export async function discover(req: Request, res: Response) {
  try {
    return res.json(await discoverInfrastructure(actor(req), req.params.sessionId, req.body || {}));
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.discover");
  }
}

export async function importCandidates(req: Request, res: Response) {
  try {
    return res.json(await importInfrastructureCandidates(actor(req), req.params.sessionId, req.body || {}));
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.import");
  }
}

export async function verifyCandidate(req: Request, res: Response) {
  try {
    return res.json({ verification: await verifyInfrastructureCandidate(actor(req), req.params.sessionId, req.params.candidateId, req.body || {}) });
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.verify");
  }
}

export async function verifyCandidates(req: Request, res: Response) {
  try {
    return res.json(await verifyInfrastructureCandidates(actor(req), req.params.sessionId, req.body || {}));
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.verify_many");
  }
}

export async function promoteCandidate(req: Request, res: Response) {
  try {
    return res.json(await promoteInfrastructureCandidate(actor(req), req.params.sessionId, req.params.candidateId));
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.promote");
  }
}

export async function promoteCandidates(req: Request, res: Response) {
  try {
    return res.json(await promoteInfrastructureCandidates(actor(req), req.params.sessionId, req.body || {}));
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.promote_many");
  }
}

export async function partners(req: Request, res: Response) {
  try {
    return res.json({ partners: await listInfrastructurePartners(actor(req)) });
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.partners");
  }
}

export async function createPartner(req: Request, res: Response) {
  try {
    return res.status(201).json({ partner: await createInfrastructurePartner(actor(req), req.body || {}) });
  } catch (error) {
    return fail(res, error, "infrastructure_onboarding.partner.create");
  }
}
