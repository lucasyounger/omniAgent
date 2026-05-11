# Troubleshooting

## Mastra Studio Input Issues

Earlier local testing found two common causes:

- Multiple dev servers using port `4111`.
- Missing storage configuration in the Mastra instance.

## Version Choice

This project uses `mastra@1.7.0` because later versions had a reported CJK IME chat input issue in Studio.
