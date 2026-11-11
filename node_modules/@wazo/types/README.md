# wazo-ts-types
TS types for Wazo APIs

## How to generate types

### Default (stable version)
To generate types from the latest production yml documentation, run the following commands:

```bash
# Install dependencies
pnpm install

# Generate the types
pnpm run build
```

Types are compiled into the `dist` directory.

### Edge environment

To generate types from an edge environment, you can override the OpenAPI spec URLs using environment variables. Create a `.env` file at the root of the project:

```bash
# Example .env file pointing to an edge environment
AUTH=https://your-dev-server.com/api/auth/1.0/api/api.yml
# ...
```

Then run the build command:
```bash
pnpm run build
```

**Note:** You only need to override the services you want to use from your dev environment. Unset variables will default to the production OpenAPI specs from `https://openapi.wazo.community/`.

## License
This project is licensed under the GPL-3 License. See the LICENSE file for more information.
