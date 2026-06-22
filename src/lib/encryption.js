import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey() {
    const encodedKey =
        process.env.SMTP_ENCRYPTION_KEY;

    if (!encodedKey) {
        throw new Error(
            "SMTP_ENCRYPTION_KEY is not configured"
        );
    }

    const key = Buffer.from(
        encodedKey,
        "base64"
    );

    if (key.length !== 32) {
        throw new Error(
            "SMTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
        );
    }

    return key;
}

export function encryptSecret(value) {
    if (!value) {
        return null;
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        ALGORITHM,
        key,
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(
            String(value),
            "utf8"
        ),
        cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return [
        iv.toString("base64"),
        authTag.toString("base64"),
        encrypted.toString("base64"),
    ].join(".");
}

export function decryptSecret(value) {
    if (!value) {
        return null;
    }

    const [
        ivPart,
        authTagPart,
        encryptedPart,
    ] = String(value).split(".");

    if (
        !ivPart ||
        !authTagPart ||
        !encryptedPart
    ) {
        throw new Error(
            "Invalid encrypted SMTP credential"
        );
    }

    const key = getEncryptionKey();

    const decipher =
        crypto.createDecipheriv(
            ALGORITHM,
            key,
            Buffer.from(ivPart, "base64")
        );

    decipher.setAuthTag(
        Buffer.from(
            authTagPart,
            "base64"
        )
    );

    const decrypted = Buffer.concat([
        decipher.update(
            Buffer.from(
                encryptedPart,
                "base64"
            )
        ),
        decipher.final(),
    ]);

    return decrypted.toString("utf8");
}