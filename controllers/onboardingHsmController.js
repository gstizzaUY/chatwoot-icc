import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();


const onboardingHsmStarterPack = async (req, res) => {

    const { message } = req.params;
    console.log('Mensaje recibido en onboardingHsmStarterPack:', message);

};

export default onboardingHsmStarterPack;