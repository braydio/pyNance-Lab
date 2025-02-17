import axios from "axios";

const API_URL = "/api/teller";

export const refreshAccounts = async () => {
    try {
        const response = await axios.post(`${API_URL}/refresh_accounts`);
        return response.data;
    } catch (error) {
        console.error("Error refreshing accounts:", error.response || error);
        throw error;
    }
};

export const getAccounts = async () => {
    try {
        const response = await axios.get(`${API_URL}/get_accounts`);
        return response.data;
    } catch (error) {
        console.error("Error fetching accounts:", error.response || error);
        throw error;
    }
};
