import { RequestHandler } from "express";
// Hardware references must never enter the legacy wallet ownership fallback.
// This is a domain-routing guard, not a change to wallet accounting.
export const rejectHardwareWalletReference: RequestHandler = (
  req,
  res,
  next,
) => {
  let path = req.path;
  try {
    path = decodeURIComponent(path);
  } catch {
    res.status(400).json({ error: "invalid_reference" });
    return;
  }
  const candidates = [
    req.query?.reference,
    req.body?.reference,
    ...path.split("/"),
  ];
  if (candidates.some((v) => /^hwo_/i.test(String(v || "").trim()))) {
    res.status(400).json({ error: "hardware_reference_not_wallet_funding" });
    return;
  }
  next();
};
