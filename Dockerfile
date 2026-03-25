FROM mcr.microsoft.com/dotnet/sdk:9.0

WORKDIR /app
COPY . .

ENV HOST=0.0.0.0
ENV PORT=10000

EXPOSE 10000

CMD ["pwsh", "-File", "/app/server.ps1"]

